#!/bin/bash
# v0.1_alpha asset generation — premium art for the platform
set -x
cd /home/z/my-project
P="high quality, detailed, professional, no text, no letters, no watermark"

gen() {
  local prompt="$1"; local out="$2"; local size="$3"
  for i in 1 2; do
    timeout 300 z-ai image -p "$prompt, $P" -o "$out" -s "$size" && [ -s "$out" ] && break
    sleep 2
  done
}

# Brand logo
gen "Elegant minimalist logo emblem for a scientific gaming company: an abstract golden brain formed by geometric orbital rings and a rising eight-pointed Persian star, emerald and amber gradient, deep midnight background, flat vector style, premium, centered" "public/brand/logo.png" "1024x1024"

# Duel of Thought
gen "Luxury wooden strategy board game top view, 9 by 7 grid of numbered round holes with amber and emerald numbered discs, ornate Persian geometric tilework wooden border, warm cinematic lighting, premium product photography" "public/art/duel-cover.jpg" "1024x1024"
gen "Cinematic hero banner: ornate wooden numbers board game on emerald velvet table beside Persian miniature paintings and an antique astrolabe, warm amber light rays, floating dust particles, premium game key art, painterly" "public/art/duel-hero.jpg" "1440x720"

# Orbit Odyssey
gen "Sci-fi game cover art: small glowing probe spacecraft slinging around a giant ringed planet, luminous trajectory arcs, deep space nebula, holographic star charts, teal and gold palette, painterly sci-fi poster" "public/art/orbit-cover.jpg" "1024x1024"
gen "Wide sci-fi key art: solar system orbital map with glowing gravity wells and slingshot trajectory arcs between planets, tiny probe ship, holographic interface lines, teal gold palette, dark cosmic background, cinematic" "public/art/orbit-hero.jpg" "1440x720"

# Synapse
gen "Glowing human brain formed by luminous neural network nodes with synapses firing light pulses, teal and violet gradient, dark background, elegant science illustration" "public/art/synapse-cover.jpg" "1024x1024"
gen "Wide neuroscience key art: futuristic mind-training interface with glowing 3x3 memory grid tiles, brain scan hologram, flowing neural pathways, teal and magenta glow on dark high-tech background, cinematic" "public/art/synapse-hero.jpg" "1440x720"

# Stellar Forge
gen "Stellar core fusion art: glowing plasma spheres merging into heavier element cores, floating glowing chemical element orbs, orange and cyan energy streams, dramatic cosmic interior of a star, painterly" "public/art/stellar-cover.jpg" "1024x1024"
gen "Wide key art: birth of a star, protostar with accretion disk fusing glowing element particles, orange gold core with cyan shockwave rings, dark cosmic dust background, cinematic, epic" "public/art/stellar-hero.jpg" "1440x720"

# Loot boxes (5 rarities)
gen "Game loot crate asset: sturdy wooden chest with brass fittings and simple iron lock, common quality, warm studio lighting, dark neutral background, centered, 3d render" "public/art/box-common.png" "1024x1024"
gen "Game loot crate asset: silver steel chest with glowing sapphire crystal and subtle cold glow, rare quality, dark background, centered, 3d render" "public/art/box-rare.png" "1024x1024"
gen "Game loot crate asset: ornate amethyst crystal chest with arcane runes and strong violet glow, epic quality, dark background, centered, 3d render" "public/art/box-epic.png" "1024x1024"
gen "Game loot crate asset: golden royal chest with radiant amber holy glow and ornate wing ornaments, legendary quality, dark background, centered, 3d render" "public/art/box-legendary.png" "1024x1024"
gen "Game loot crate asset: cosmic obsidian chest with a swirling galaxy nebula inside and tiny stars orbiting it, ultimate mythical quality, dark background, centered, 3d render" "public/art/box-ultimate.png" "1024x1024"

echo "ALL_DONE"
