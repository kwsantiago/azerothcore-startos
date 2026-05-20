import { storeJson } from './fileModels/store.json'
import { i18n } from './i18n'
import { sdk } from './sdk'
import { authPort, dbName, dbPort, resolveRealmHost, worldPort } from './utils'
import { isPlayerbots, roleImage } from './variant'

const dbGracePeriod = 30_000
const worldGracePeriod = 120_000 // first boot loads maps + DB, can be slow

// Client-data download, idempotent: skips if maps already present.
const CLIENT_DATA_CMD: [string, ...string[]] = [
  'bash',
  '-c',
  '[ -d /azerothcore/env/dist/data/dbc ] && echo "client data present, skipping" || (source /azerothcore/apps/installer/includes/functions.sh && inst_download_client_data)',
]

const DB_IMPORT_CMD: [string, ...string[]] = [
  '/usr/bin/env',
  'bash',
  '/azerothcore/entrypoint.sh',
  '/azerothcore/env/dist/bin/dbimport',
]

// Run an AC binary through the consolidated playerbots image entrypoint.
const acoreCmd = (binary: string): [string, ...string[]] => [
  '/usr/bin/env',
  'bash',
  '/azerothcore/entrypoint.sh',
  `/azerothcore/env/dist/bin/${binary}`,
]

const mysqlExec = (pw: string, sql: string) => ({
  command: [
    'mysql',
    '-h',
    '127.0.0.1',
    '-P',
    dbPort.toString(),
    '-uroot',
    `-p${pw}`,
    '-e',
    sql,
  ] as [string, ...string[]],
})

export const main = sdk.setupMain(async ({ effects }) => {
  console.log(`Starting AzerothCore${isPlayerbots ? ' (Playerbots)' : ''}!`)

  const store = await storeJson.read().const(effects)
  if (!store) throw new Error('no store.json')

  const host = await resolveRealmHost(effects, store.realmAddress)
  console.log(`Realm address resolved to ${host}`)

  const dbEnv = { MYSQL_ROOT_PASSWORD: store.dbPassword }
  const conn = (name: string) =>
    `127.0.0.1;${dbPort};root;${store.dbPassword};${name}`

  const baseEnv: Record<string, string> = {
    AC_LOGIN_DATABASE_INFO: conn(dbName.auth),
    AC_WORLD_DATABASE_INFO: conn(dbName.world),
    AC_CHARACTER_DATABASE_INFO: conn(dbName.characters),
    AC_DATA_DIR: '/azerothcore/env/dist/data',
    AC_CONSOLE_ENABLE: '0',
  }

  const realmSql =
    `UPDATE ${dbName.auth}.realmlist ` +
    `SET address='${host}', localAddress='${host}', ` +
    `port=${worldPort}, name='${store.realmName.replace(/'/g, '')}' ` +
    `WHERE id=1;`

  // Shared subcontainer factories
  const dbSub = () =>
    sdk.SubContainer.of(
      effects,
      { imageId: roleImage.database },
      sdk.Mounts.of().mountVolume({
        volumeId: 'main',
        subpath: 'mysql',
        mountpoint: '/var/lib/mysql',
        readonly: false,
      }),
      'database-sub',
    )
  const dbReady = {
    display: i18n('Database'),
    gracePeriod: dbGracePeriod,
    fn: () =>
      sdk.healthCheck.checkPortListening(effects, dbPort, {
        successMessage: i18n('Database is ready'),
        errorMessage: i18n('Database is starting'),
      }),
  }
  const clientDataSub = () =>
    sdk.SubContainer.of(
      effects,
      { imageId: roleImage.clientData },
      sdk.Mounts.of().mountVolume({
        volumeId: 'main',
        subpath: 'data',
        mountpoint: '/azerothcore/env/dist/data',
        readonly: false,
      }),
      'client-data-sub',
    )
  const worldSub = () =>
    sdk.SubContainer.of(
      effects,
      { imageId: roleImage.world },
      sdk.Mounts.of().mountVolume({
        volumeId: 'main',
        subpath: 'data',
        mountpoint: '/azerothcore/env/dist/data',
        readonly: true,
      }),
      'worldserver-sub',
    )
  const authReady = {
    display: i18n('Auth Server'),
    fn: () =>
      sdk.healthCheck.checkPortListening(effects, authPort, {
        successMessage: i18n('Auth server is ready'),
        errorMessage: i18n('Auth server is starting'),
      }),
  }
  const worldReady = {
    display: i18n('World Server'),
    gracePeriod: worldGracePeriod,
    fn: () =>
      sdk.healthCheck.checkPortListening(effects, worldPort, {
        successMessage: i18n('World server is ready'),
        errorMessage: i18n('World server is loading'),
      }),
  }

  // ─────────────────────────── Playerbots ───────────────────────────
  if (isPlayerbots) {
    const botsOn = store.playerbots.enabled
    const serverEnv = {
      ...baseEnv,
      AC_PLAYERBOTS_DATABASE_INFO: conn(dbName.playerbots),
      AC_AIPLAYERBOT_ENABLED: botsOn ? '1' : '0',
      AC_AIPLAYERBOT_RANDOMBOTAUTOLOGIN: botsOn ? '1' : '0',
      AC_AIPLAYERBOT_MINRANDOMBOTS: String(store.playerbots.minBots),
      AC_AIPLAYERBOT_MAXRANDOMBOTS: String(store.playerbots.maxBots),
    }
    const exec = (binary: string) => ({
      command: acoreCmd(binary),
      env: { ...serverEnv, ACORE_COMPONENT: binary },
    })

    return sdk.Daemons.of(effects)
      .addDaemon('database', {
        subcontainer: await dbSub(),
        exec: { command: sdk.useEntrypoint(), env: dbEnv },
        ready: dbReady,
        requires: [],
      })
      .addOneshot('client-data', {
        subcontainer: await clientDataSub(),
        exec: { command: CLIENT_DATA_CMD },
        requires: [],
      })
      .addOneshot('db-import', {
        subcontainer: await sdk.SubContainer.of(
          effects,
          { imageId: roleImage.dbImport },
          null,
          'db-import-sub',
        ),
        exec: exec('dbimport'),
        requires: ['database'],
      })
      .addOneshot('playerbots-db', {
        subcontainer: await sdk.SubContainer.of(
          effects,
          { imageId: roleImage.database },
          null,
          'playerbots-db-sub',
        ),
        exec: mysqlExec(
          store.dbPassword,
          `CREATE DATABASE IF NOT EXISTS ${dbName.playerbots} ` +
            `DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;`,
        ),
        requires: ['database'],
      })
      .addOneshot('realm-config', {
        subcontainer: await sdk.SubContainer.of(
          effects,
          { imageId: roleImage.database },
          null,
          'realm-config-sub',
        ),
        exec: mysqlExec(store.dbPassword, realmSql),
        requires: ['db-import'],
      })
      .addDaemon('authserver', {
        subcontainer: await sdk.SubContainer.of(
          effects,
          { imageId: roleImage.auth },
          null,
          'authserver-sub',
        ),
        exec: exec('authserver'),
        ready: authReady,
        requires: ['realm-config'],
      })
      .addDaemon('worldserver', {
        subcontainer: await worldSub(),
        exec: exec('worldserver'),
        ready: worldReady,
        requires: ['db-import', 'client-data', 'playerbots-db'],
      })
  }

  // ──────────────────────────── Vanilla ─────────────────────────────
  const serverEnv = baseEnv
  return sdk.Daemons.of(effects)
    .addDaemon('database', {
      subcontainer: await dbSub(),
      exec: { command: sdk.useEntrypoint(), env: dbEnv },
      ready: dbReady,
      requires: [],
    })
    .addOneshot('client-data', {
      subcontainer: await clientDataSub(),
      exec: { command: CLIENT_DATA_CMD },
      requires: [],
    })
    .addOneshot('db-import', {
      subcontainer: await sdk.SubContainer.of(
        effects,
        { imageId: roleImage.dbImport },
        null,
        'db-import-sub',
      ),
      exec: { command: DB_IMPORT_CMD, env: serverEnv },
      requires: ['database'],
    })
    .addOneshot('realm-config', {
      subcontainer: await sdk.SubContainer.of(
        effects,
        { imageId: roleImage.database },
        null,
        'realm-config-sub',
      ),
      exec: mysqlExec(store.dbPassword, realmSql),
      requires: ['db-import'],
    })
    .addDaemon('authserver', {
      subcontainer: await sdk.SubContainer.of(
        effects,
        { imageId: roleImage.auth },
        null,
        'authserver-sub',
      ),
      exec: { command: sdk.useEntrypoint(), env: serverEnv },
      ready: authReady,
      requires: ['realm-config'],
    })
    .addDaemon('worldserver', {
      subcontainer: await worldSub(),
      exec: { command: sdk.useEntrypoint(), env: serverEnv },
      ready: worldReady,
      requires: ['db-import', 'client-data'],
    })
})
