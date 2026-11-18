#!/bin/sh
# Updates JeffCode on macOS to the latest release, or to the release given as argument (e.g. 0.5.2).
#
#   curl -fsSL https://raw.githubusercontent.com/JeffLord123/JeffCode/jeffcode/scripts/jeffcode-update.sh | sh
#
# The app is not signed by Apple, so it cannot update itself: this downloads the release for this
# Mac, replaces /Applications/JeffCode.app, clears the quarantine and opens the new version.
set -eu

repo="JeffLord123/JeffCode"
app="/Applications/JeffCode.app"

if [ "$(uname -s)" != "Darwin" ]; then
	echo "jeffcode-update is for macOS. On Windows, JeffCode updates itself." >&2
	exit 1
fi

case "$(uname -m)" in
	arm64) arch="arm64" ;;
	x86_64)
		# A Terminal running under Rosetta reports x86_64 on Apple Silicon.
		if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then arch="arm64"; else arch="x64"; fi
		;;
	*) echo "Unsupported processor: $(uname -m)" >&2; exit 1 ;;
esac

if [ $# -ge 1 ]; then
	version="${1#jeffcode-}"
else
	version="$(curl -fsSL "https://api.github.com/repos/$repo/releases/latest" | sed -n 's/.*"tag_name": *"jeffcode-\([^"]*\)".*/\1/p' | head -n 1)"
	if [ -z "$version" ]; then
		echo "Could not find the latest JeffCode release." >&2
		exit 1
	fi
fi

echo "Installing JeffCode $version ($arch)..."

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
curl -fL --progress-bar -o "$work/JeffCode.zip" "https://github.com/$repo/releases/download/jeffcode-$version/JeffCode-$version-darwin-$arch.zip"
ditto -x -k "$work/JeffCode.zip" "$work/app"
if [ ! -d "$work/app/JeffCode.app" ]; then
	echo "The download does not contain JeffCode.app." >&2
	exit 1
fi

# Quit JeffCode before replacing it.
if pgrep -xq JeffCode 2>/dev/null || pgrep -fq "$app/Contents/MacOS/" 2>/dev/null; then
	echo "Quitting JeffCode..."
	osascript -e 'quit app "JeffCode"' >/dev/null 2>&1 || true
	for _ in 1 2 3 4 5 6 7 8 9 10; do
		pgrep -fq "$app/Contents/MacOS/" 2>/dev/null || break
		sleep 1
	done
fi

rm -rf "$app"
mv "$work/app/JeffCode.app" "$app"
xattr -cr "$app"
echo "JeffCode $version is installed."
open "$app"
