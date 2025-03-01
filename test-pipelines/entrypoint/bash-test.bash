#!/bin/bash

if [[ -z "$BASH_VERSION" ]]; then
  echo "Not running in Bash or BASH_VERSION is not set."
  exit 1
else
  echo "Bash version: $BASH_VERSION"
  exit 0
fi