import { setupManifest } from '@start9labs/start-sdk'
import { longDescription, shortDescription } from './i18n'
import { isPlayerbots, packageId, packageTitle } from '../variant'

// Vanilla references AzerothCore's official prebuilt images (acore/ac-wotlk-*).
// Playerbots compiles the mod-playerbots fork from source via Dockerfile.playerbots
// into one consolidated image ('acore') that serves auth/world/db-import roles.
const ACORE_TAG = '16.0.0-dev' // TODO: pin to an immutable digest

const ARCH_BOTH: ['x86_64', 'aarch64'] = ['x86_64', 'aarch64']
const ARCH_X86: ['x86_64'] = ['x86_64']

const vanillaImages = {
  database: { source: { dockerTag: 'mysql:8.4' }, arch: ARCH_BOTH },
  authserver: {
    source: { dockerTag: `acore/ac-wotlk-authserver:${ACORE_TAG}` },
    arch: ARCH_BOTH,
  },
  worldserver: {
    source: { dockerTag: `acore/ac-wotlk-worldserver:${ACORE_TAG}` },
    arch: ARCH_BOTH,
  },
  'db-import': {
    source: { dockerTag: `acore/ac-wotlk-db-import:${ACORE_TAG}` },
    arch: ARCH_BOTH,
  },
  'client-data': {
    source: { dockerTag: `acore/ac-wotlk-client-data:${ACORE_TAG}` },
    arch: ARCH_BOTH,
  },
}

const playerbotsImages = {
  database: { source: { dockerTag: 'mysql:8.4' }, arch: ARCH_BOTH },
  // One consolidated fork image for auth + world + db-import.
  acore: {
    source: { dockerBuild: { dockerfile: './Dockerfile.playerbots' } },
    arch: ARCH_X86,
  },
  // The client-data downloader is version-agnostic — reuse the official one.
  'client-data': {
    source: { dockerTag: `acore/ac-wotlk-client-data:${ACORE_TAG}` },
    arch: ARCH_BOTH,
  },
}

export const manifest = setupManifest({
  id: packageId,
  title: packageTitle,
  license: 'MIT',
  packageRepo: 'https://github.com/kwsantiago/azerothcore-startos',
  upstreamRepo: isPlayerbots
    ? 'https://github.com/mod-playerbots/azerothcore-wotlk'
    : 'https://github.com/azerothcore/azerothcore-wotlk',
  marketingUrl: 'https://www.azerothcore.org/',
  donationUrl: 'https://www.azerothcore.org/#donate',
  description: {
    short: shortDescription,
    long: longDescription,
  },
  volumes: ['main'],
  // Cast to the intersection so the manifest's image-id type spans every id
  // either variant can use; only the active variant's ids are referenced.
  images: (isPlayerbots ? playerbotsImages : vanillaImages) as typeof vanillaImages &
    typeof playerbotsImages,
  dependencies: {},
})
