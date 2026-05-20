# overrides to s9pk.mk must precede the include statement
#
# Two variants from one repo (see startos/variant.ts):
#   make               → vanilla   (azerothcore.s9pk, official acore images)
#   make playerbots    → playerbots (azerothcore-playerbots.s9pk, fork built
#                                     from Dockerfile.playerbots)
#
# Default `make` builds only vanilla (fast — official images). Playerbots is an
# explicit `make playerbots` opt-in (slow — compiles the fork from source, x86).
TARGETS := vanilla-x86 vanilla-arm
ARCHES := x86 arm

include s9pk.mk

.PHONY += vanilla playerbots

# Aggregate variant targets.
vanilla: vanilla-x86 vanilla-arm
playerbots: playerbots-x86

# Variant leaf rules: <variant>-<arch> sets VARIANT and recurses into the
# s9pk.mk arch recipe.
vanilla-%:;    VARIANT=vanilla    $(MAKE) $*
playerbots-%:; VARIANT=playerbots $(MAKE) $*
