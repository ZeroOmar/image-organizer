#!/usr/bin/env bash
# Regenerates the small sample media in fixtures/ (committed). Needs ffmpeg + exiftool;
# HEIC needs macOS `sips` (skipped elsewhere). Run from anywhere: scripts/make-fixtures.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/fixtures"
rm -rf "$OUT"
mkdir -p "$OUT/media/Trips/Bikers" "$OUT/media/Family" "$OUT/import/Phone"

img() { # img <out> <color> <label>
  ffmpeg -loglevel error -y -f lavfi -i "color=c=$2:s=640x480" \
    -vf "drawtext=text='$3':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2" \
    -frames:v 1 -q:v 6 "$1" 2>/dev/null ||
  ffmpeg -loglevel error -y -f lavfi -i "testsrc=s=640x480" -frames:v 1 -q:v 6 "$1"
}
vid() { # vid <out>
  ffmpeg -loglevel error -y -f lavfi -i "testsrc=s=320x240:d=2:r=15" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$1"
}
et() { exiftool -q -overwrite_original "$@"; }
touchutc() { # touchutc <YYYYMMDDhhmm.ss> <file>
  TZ=UTC touch -t "$1" "$2"
}

B="$OUT/media/Trips/Bikers"
# Camera photo with everything set.
img "$B/IMG_0001.jpg" teal camera
et -Make=INFINIX -Model=X6833B -DateTimeOriginal="2026:10:08 09:39:00" -CreateDate="2026:10:08 09:39:00" \
  -OffsetTimeOriginal=+03:00 -GPSLatitude=31.2001 -GPSLatitudeRef=N -GPSLongitude=29.9187 -GPSLongitudeRef=E "$B/IMG_0001.jpg"
touchutc 202610080639.00 "$B/IMG_0001.jpg"

# A burst: same second, different sub-seconds, no offset (zone comes from GPS → Africa/Cairo).
for s in a:100 b:500 c:900; do
  n="${s%%:*}"; ms="${s##*:}"
  img "$B/burst_$n.jpg" navy "burst $n"
  et -Make=INFINIX -Model=X6833B -DateTimeOriginal="2026:10:08 09:40:04" -SubSecTimeOriginal="$ms" \
    -GPSLatitude=30.0444 -GPSLatitudeRef=N -GPSLongitude=31.2357 -GPSLongitudeRef=E "$B/burst_$n.jpg"
  touchutc 202610080640.04 "$B/burst_$n.jpg"
done

# WhatsApp copy: all metadata stripped, date only in the name.
img "$B/IMG-20261008-WA0001.jpeg" maroon whatsapp
et -all= "$B/IMG-20261008-WA0001.jpeg"
touchutc 202610081215.30 "$B/IMG-20261008-WA0001.jpeg"

# Has a date but no GPS, and a file date far from the capture date.
img "$B/DSC_0420.jpg" olive "no gps"
et -Make=Canon -Model="EOS R6" -DateTimeOriginal="2026:10:08 10:09:40" "$B/DSC_0420.jpg"
touchutc 202610200900.00 "$B/DSC_0420.jpg"

# Screenshot: date+time only in the name.
img "$B/Screenshot 2026-10-08 at 10.15.00.png" purple screenshot
touchutc 202610080715.00 "$B/Screenshot 2026-10-08 at 10.15.00.png"

# Videos: QuickTime dates are UTC.
vid "$B/clip.mp4"
et -api QuickTimeUTC=0 -QuickTime:CreateDate="2026:10:08 06:41:00" -QuickTime:ModifyDate="2026:10:08 06:41:00" \
  -Keys:GPSCoordinates#="31.2001 29.9187 0" "$B/clip.mp4"
touchutc 202610080641.00 "$B/clip.mp4"
vid "$B/VID-20261008-WA0002.mp4"
et -all= "$B/VID-20261008-WA0002.mp4" || true
touchutc 202610081300.00 "$B/VID-20261008-WA0002.mp4"
vid "$B/MOV_0001.mov"
et -QuickTime:CreateDate="2026:10:08 06:50:10" "$B/MOV_0001.mov"
touchutc 202610080650.10 "$B/MOV_0001.mov"

# HEIC (macOS only).
if command -v sips >/dev/null; then
  img "$OUT/media/Family/tmp.jpg" darkgreen heic
  et -Make=Apple -Model="iPhone 15" -DateTimeOriginal="2026:09:01 18:30:00" -OffsetTimeOriginal=+02:00 \
    -GPSLatitude=48.8584 -GPSLatitudeRef=N -GPSLongitude=2.2945 -GPSLongitudeRef=E "$OUT/media/Family/tmp.jpg"
  sips -s format heic "$OUT/media/Family/tmp.jpg" --out "$OUT/media/Family/IMG_2001.HEIC" >/dev/null
  et -tagsFromFile "$OUT/media/Family/tmp.jpg" -all:all "$OUT/media/Family/IMG_2001.HEIC"
  rm "$OUT/media/Family/tmp.jpg"
fi
img "$OUT/media/Family/20260901_183500_PIC.jpg" darkgreen family
et -Make=Apple -Model="iPhone 15" -DateTimeOriginal="2026:09:01 18:35:00" -OffsetTimeOriginal=+02:00 "$OUT/media/Family/20260901_183500_PIC.jpg"

# Incoming files for the Import page.
P="$OUT/import/Phone"
img "$OUT/import/IMG-20261009-WA0003.jpg" maroon incoming
et -all= "$OUT/import/IMG-20261009-WA0003.jpg"
touchutc 202610090800.00 "$OUT/import/IMG-20261009-WA0003.jpg"
img "$P/IMG_20261009_120000.jpg" teal phone
et -Make=Google -Model="Pixel 9" -DateTimeOriginal="2026:10:09 12:00:00" "$P/IMG_20261009_120000.jpg"
vid "$P/VID-20261009-WA0004.mp4"
et -all= "$P/VID-20261009-WA0004.mp4" || true

echo "Fixtures written to $OUT"
find "$OUT" -type f | sort
