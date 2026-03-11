#!/bin/sh
#
# Gradle start up script for POSIX compatible shells.
#
APP_HOME="${APP_HOME:-$(dirname "$0")}"
APP_HOME="$(cd "$APP_HOME" && pwd)"
CLASSPATH=$APP_HOME/gradle/wrapper/gradle-wrapper.jar
APP_NAME="Gradle"

warn () { echo "$*"; }
die () { echo; echo "$*"; echo; exit 1; }

if [ "$APP_HOME" = "" ]; then
    die "ERROR: GRADLE_OPTS is empty. Please check your configuration."
fi

set_java_home () {
    if [ -n "$JAVA_HOME" ]; then
        JAVACMD="$JAVA_HOME/bin/java"
    else
        JAVACMD="$(which java)"
    fi
}
set_java_home

exec "$JAVACMD" \
  -classpath "$CLASSPATH" \
  org.gradle.wrapper.GradleWrapperMain \
  "$@"
