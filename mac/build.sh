#!/bin/zsh
# Fon.app'i derler: web dosyalarını pakete kopyalar, Swift'i evrensel (arm64 + x86_64) derler, ad-hoc imzalar.
set -e
cd "${0:A:h}"
ROOT=..
APP=build/Fon.app
rm -rf build && mkdir -p $APP/Contents/MacOS $APP/Contents/Resources/web/js build/obj

cp Info.plist $APP/Contents/
cp $ROOT/index.html $ROOT/styles.css $APP/Contents/Resources/web/
cp $ROOT/js/*.js $APP/Contents/Resources/web/js/

# simge (icon/Fon.icns yoksa icon.html'den üret)
if [[ ! -f icon/Fon.icns ]]; then
  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --window-size=1024,1024 --screenshot="$PWD/build/obj/icon.png" "file://$PWD/icon/icon.html" >/dev/null 2>&1
  mkdir -p build/obj/Fon.iconset
  for s in 16 32 128 256 512; do
    sips -z $s $s build/obj/icon.png --out build/obj/Fon.iconset/icon_${s}x${s}.png >/dev/null
    sips -z $((s*2)) $((s*2)) build/obj/icon.png --out build/obj/Fon.iconset/icon_${s}x${s}@2x.png >/dev/null
  done
  iconutil -c icns build/obj/Fon.iconset -o icon/Fon.icns
fi
cp icon/Fon.icns $APP/Contents/Resources/

for arch in arm64 x86_64; do
  swiftc -O -target $arch-apple-macos13.0 Fon.swift -o build/obj/Fon-$arch -framework Cocoa -framework WebKit
done
lipo -create build/obj/Fon-arm64 build/obj/Fon-x86_64 -output $APP/Contents/MacOS/Fon
codesign --force --deep -s - $APP
mkdir -p $ROOT/indir && rm -f $ROOT/indir/Fon-mac.zip
ditto -c -k --keepParent $APP $ROOT/indir/Fon-mac.zip
echo "Hazır: $PWD/$APP + indir/Fon-mac.zip"
