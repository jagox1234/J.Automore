#!/usr/bin/env sh
if [ -z "$husky_skip_init" ]; then
  debug () {
    [ "$HUSKY_DEBUG" = "1" ] && echo "husky (debug) - $1"
  }
  readonly husky_skip_init=1
  export husky_skip_init
  debug "starting..."
  if [ "$HUSKY" = "0" ]; then
    debug "HUSKY env variable is set to 0, skipping hook"; exit 0
  fi
  if [ -f ~/.huskyrc ]; then
    debug "~/.huskyrc is present, sourcing"; . ~/.huskyrc
  fi
  export readonly husky_skip_init
  sh -e "$0" "$@"
  exitCode=$?
  debug "done"; exit $exitCode
fi
