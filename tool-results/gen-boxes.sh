#!/usr/bin/env bash
# Task 6-a: generate the 5 chest renders referenced by /api/market (were 404).
cd /home/z/my-project || exit 1
P="plain very dark midnight background, centered single object, premium mobile game loot box asset render, high quality, detailed, professional, no text, no letters, no watermark"
gen() {
  echo "== $(date +%T) gen $1"
  if timeout 280 z-ai image -p "$2, $P" -o "public/art/$1" -s 1024x1024; then
    echo "OK $1"
  else
    echo "FAIL $1"
  fi
}
echo "== chest art generation started $(date) =="
gen box-common.png    "weathered wooden treasure chest with dark iron bands, soft pale silver-green glow of light escaping from the slightly open lid"
gen box-rare.png      "polished treasure chest with silver bands and glowing emerald green gems, radiant green light escaping from the slightly open lid"
gen box-epic.png      "arcane treasure chest decorated with glowing violet purple crystals, purple magic energy escaping from the slightly open lid"
gen box-legendary.png "royal golden treasure chest with ornate gold ornaments and filigree, radiant golden light escaping from the slightly open lid"
gen box-ultimate.png  "mythical obsidian black treasure chest with crimson rose-red energy cracks and floating ruby gems, fiery red glow escaping from the slightly open lid"
echo "== chest art generation finished $(date) =="
ls -la public/art/box-*.png 2>/dev/null || echo "NO BOX FILES PRODUCED"
