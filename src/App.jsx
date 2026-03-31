import { useState } from "react";

// ═══════════════════════════════════════════════════════════════
// REAL PRODUCT DATA (from howlcampfires.com, March 2026)
// ═══════════════════════════════════════════════════════════════
const PRODUCTS = [
  {
    id: "r1",
    name: "R1",
    price: "$374",
    tagline: "World's Most Portable Campfire",
    subtitle: "Your 40°F Fire",
    specs: {
      weight: "11 lbs (about two chihuahuas)",
      dimensions: '13.275" x 8.43" x 6.05" legs in',
      burnTime: "8 hrs full blast on 20lb tank",
      opTemp: "800°F",
      flameHeight: "32 inches nil wind",
      btu: "54,000 BTUs/hr max",
      burners: "1 A-Flame Burner",
      materials: "304 stainless steel, aircraft aluminum, brass",
    },
    brandCopy: [
      "The only propane fire pit with 32-inch flames, a tiny frame, and party-all-night efficiency.",
      "Built for multi-day missions in tightly packed rigs with long stretches between resupplies.",
      "With the legs folded in, it's the size of a shoebox.",
      "The world's most efficient big-flame fire pit. Crank it to full blast and party all night on a single tank.",
      "160 precision micro-emitters make 160 tiny flames, which all band together to stretch for the sky.",
      "Firelight to tell tales by. Efficiency for days. Small enough to mount to your prerunner.",
    ],
    features: ["A-Flame Burner", "FlexDome Windscreen", "Gullwing Legs", "PressBrake Frame", "Tank-Stabilizing Design"],
  },
  {
    id: "r4mkii",
    name: "R4 MKii",
    price: "$1,474",
    tagline: "World's Hottest Propane Fire Pit",
    subtitle: "Your 0°F Fire",
    specs: {
      weight: "27 lbs",
      dimensions: '21.00" x 14.34" x 7.53" legs in',
      burnTime: "6.5-10 hrs on 20lb tank",
      opTemp: "1,300+°F",
      flameHeight: "24 inches nil wind",
      btu: "62,000 BTUs/hr max",
      burners: "3 total: 2 BarCoals + 1 A-Flame",
      materials: "304 stainless steel, aircraft aluminum, brass",
    },
    brandCopy: [
      "Like no other campfire, it cranks out thigh-melting heat in wild winds, monsoon rains, and right in the middle of a burn ban.",
      "Keeps you warm in any weather, at any altitude, and on any piece of ground you can get to.",
      "BarCoal tubes absolutely rip at 1,300+ degrees Fahrenheit.",
      "Thigh-melting heat. Firelight to tie flies and tell tales by. Plus, you can huck your truck with it.",
      "100°F hotter, 7 lbs lighter, with Jackknife folding legs.",
      "A campsite workhorse that walks softly upon the earth.",
    ],
    features: ["BarCoal® Radiant Heater", "EchoHeat Reflector Shields", "A-Flame Burner", "PressBrake Frame", "Jackknife Folding Legs"],
  },
];

// ═══════════════════════════════════════════════════════════════
// 7 CREATIVE ANGLES FROM 938 REVIEW ANALYSIS
// ═══════════════════════════════════════════════════════════════
const ANGLES = [
  {
    id: "burn_ban",
    label: "Burn Ban Savior",
    icon: "🔥",
    desc: "Origin story. #1 functional differentiator.",
    funnel: "TOF cold traffic, widest reach",
    frequency: "25+ explicit, 60+ implied",
    customerLanguage: [
      "We were the only ones with a campfire.",
      "A park ranger drove over to check our setup. He took one look and said 'yep, you're good.'",
      "Burn ban season used to mean no campfire. Not anymore.",
      "Every campground in the state is under a burn ban right now. We still had a fire.",
    ],
  },
  {
    id: "skeptic",
    label: "Skeptic Converter",
    icon: "🤯",
    desc: "Price objection to evangelist arc.",
    funnel: "TOF + MOF, UGC testimonial",
    frequency: "30+ reviews with explicit skepticism",
    customerLanguage: [
      "Why haven't you bought one yet?! I was skeptical. Your search for a campfire is over.",
      "It's like my YETI cooler. Buy it once and have it for life.",
      "My wife thought I was crazy for spending this much. Here's what she said after the first night.",
      "I almost didn't buy this. Let me tell you why I'm glad I did.",
    ],
  },
  {
    id: "heat",
    label: "The Heat Is Real",
    icon: "🌡️",
    desc: "Performance proof. #1 referenced attribute.",
    funnel: "TOF + MOF, demo-driven",
    frequency: "'Heat' in 200+ reviews",
    customerLanguage: [
      "My wife had to back her chair up. That's never happened with a propane fire.",
      "In flame-only mode, it feels like a propane fire. Lame. Then with the radiant heat turned on... immediately apparent.",
      "As soon as I got within 8 feet, I could feel the heat and see those glowing pipes.",
      "1,300 degrees. From propane. No, seriously.",
    ],
  },
  {
    id: "craftsmanship",
    label: "Built Like a Tank",
    icon: "⚙️",
    desc: "BIFL craftsmanship, made in Colorado.",
    funnel: "MOF retargeting + BOF landing page",
    frequency: "'Built like a tank' 13x, 'quality' in 80+ reviews",
    customerLanguage: [
      "292 parts. Zero plastic. Zero electronics. Built in Colorado.",
      "The YETI of campfires exists and it's made in Colorado.",
      "As a mechanical engineer, it is really fun to see and feel this in action.",
      "Most fire pits are built to a price. This one is built to last your whole life.",
    ],
  },
  {
    id: "community",
    label: "Campfire Is the Trip",
    icon: "🏕️",
    desc: "Emotional core. Gathering and belonging.",
    funnel: "TOF brand awareness, emotional/aspirational",
    frequency: "Community language in 40+ reviews",
    customerLanguage: [
      "The best part of camping isn't the hike. It's this.",
      "Everyone walking by stopped for a little heat and asked what it was.",
      "We were the only campsite people gathered around.",
      "Camping without a fire is just sleeping outside.",
      "My friends came for the trip. They stayed for the fire.",
    ],
  },
  {
    id: "portability",
    label: "Small Package, Massive Output",
    icon: "📦",
    desc: "R1 size-to-performance shock. Visual hook.",
    funnel: "TOF TikTok + Meta Reels, size reveal",
    frequency: "'Compact/portable/size' in 100+ R1 reviews",
    customerLanguage: [
      "Literally the size of a tennis shoe box.",
      "Small but mighty. This little thing cranks.",
      "I have a Jeep so size and weight are very important. Heading to the Arctic Circle.",
      "Smaller than a six-pack. Hotter than a bonfire.",
      "11 pounds. That's it.",
    ],
  },
  {
    id: "four_season",
    label: "4-Season Workhorse",
    icon: "❄️",
    desc: "Extreme conditions. Separates from patio brands.",
    funnel: "TOF hunting/ski/overland targeting, seasonal",
    frequency: "Cold/rain/wind/altitude in 30+ reviews",
    customerLanguage: [
      "6 degrees out or something dumb. Worth every penny and warmed me up.",
      "First night on the beach with constant onshore wind. Kept us toasty warm.",
      "Perfect tailgating heat source for winter Buffalo Bills games.",
      "Rain. Wind. Altitude. Burn ban. Nothing stops this thing.",
    ],
  },
];

// ═══════════════════════════════════════════════════════════════
// CUSTOMER AVATARS
// ═══════════════════════════════════════════════════════════════
const AVATARS = [
  { id: "truck_camper", label: "Western Truck Camper", desc: "Male 30-45, $100K+ HHI, dispersed camping CO/UT/MT/WY/PNW", platforms: "Meta, YouTube, TikTok" },
  { id: "overlander", label: "Overland Rig Builder", desc: "Dedicated build, every sq inch accounted for, follows overland media", platforms: "YouTube, Instagram, TikTok" },
  { id: "hunter", label: "Hunting Camp Regular", desc: "Elk/antelope/turkey, cold remote conditions, no-smoke matters", platforms: "Meta, YouTube, podcasts" },
  { id: "ski_bum", label: "Ski Bum / Apres Crew", desc: "Resort parking lot tailgaters, social/apres experience", platforms: "TikTok, IG Reels, Meta (Oct-Mar)" },
  { id: "couple", label: "Backyard-to-Backcountry Couple", desc: "Both enjoy outdoors, use at home AND trips, gift purchase", platforms: "Meta broad, gift-season campaigns" },
  { id: "gear_nerd", label: "Gear Nerd / Engineer", desc: "Researches everything, reads specs, appreciates BarCoal tech", platforms: "YouTube long-form, Meta MOF, Reddit" },
];

const PLATFORMS = [
  { id: "meta", label: "Meta (FB/IG)", charLimits: { headline: 40, primary: 125, description: 30 } },
  { id: "tiktok", label: "TikTok", charLimits: { headline: 50, primary: 100, description: 0 } },
  { id: "google", label: "Google Ads", charLimits: { headline: 30, primary: 90, description: 90 } },
];

const COPY_COUNT_OPTIONS = [5, 10, 25, 50];

// ═══════════════════════════════════════════════════════════════
// BUILD THE SYSTEM PROMPT WITH ALL REAL DATA
// ═══════════════════════════════════════════════════════════════
function buildSystemPrompt() {
  return `You are an elite direct-response copywriter for HOWL Campfires, a premium e-commerce brand based in Wheat Ridge, Colorado. HOWL makes the world's hottest and most portable propane fire pits, designed, cut, bent, welded, assembled, and tested in Colorado.

BRAND VOICE:
- Punchy, conversational, non-corporate. Influenced by Dan Kennedy, Gary Halbert, and Russell Brunson.
- NEVER use em dashes. Use periods, commas, or ellipses instead.
- Write like a real person talking to a friend at camp. Not a brand talking to a consumer.
- The HOWL voice is confident, a little irreverent, and obsessed with performance.
- Brand tagline: "More heat. More light. More freedom."
- Mission: "Build tools that keep the forest and the fire alive."
- 84% of wildfires are human-caused, so burn bans are becoming the norm. Camping without a fire is lame. That's why HOWL exists.
- Slogan on site: "CHOOSE YOUR BURN BAN BEATER"

BRAND FACTS:
- Founded by four engineers who decided propane fire pits suck
- All manufacturing in Wheat Ridge, Colorado (Front Range)
- 938 verified reviews, 90.4% are 5-star
- UL Certified, legal in Stage II Burn Bans in all 50 states (check local regs)
- No plastic. No electronics. No fans. No batteries. Nothing that wears out or breaks.
- Materials: 304 stainless steel, aircraft aluminum, brass
- Proprietary tech: BarCoal® (radiant tube heater), A-Flame® (most fuel-efficient flame on earth), FlexDome Windscreen, EchoHeat Reflector Shields

PRODUCTS:

R1 — "The Fast-and-Light Campfire" ($374)
- World's most portable campfire
- "Your 40°F Fire"
- 11 lbs, size of a shoebox (13.275" x 8.43" x 6.05" legs in)
- 32-inch flames nil wind
- 800°F operating temp
- 8 hours full blast on 20lb tank (54,000 BTUs/hr max)
- 1 A-Flame Burner, 160 precision micro-emitters
- Gullwing folding legs, PressBrake frame, FlexDome Windscreen
- Tank-stabilizing design so you can huck your truck with it
- Site copy: "Firelight to tell tales by. Efficiency for days. Small enough to mount to your prerunner."
- Site copy: "Crank it to full blast and party all night on a single tank. Or turn it down low and burn it for days. Literally."
- Key R1 selling point: the size-to-performance ratio is genuinely shocking

R4 MKii — "The 4-Season Campfire" ($1,474)
- World's hottest propane fire pit
- "Your 0°F Fire"
- 27 lbs (21" x 14.34" x 7.53" legs in)
- 24-inch flames nil wind
- 1,300+°F operating temp
- 6.5-10 hours on 20lb tank (62,000 BTUs/hr max)
- 3 burners: 2 BarCoal radiant heaters + 1 A-Flame
- EchoHeat Reflector Shields keep the ground cool
- Jackknife folding legs, PressBrake frame
- Site copy: "Thigh-melting heat. Firelight to tie flies and tell tales by. Plus, you can huck your truck with it."
- Site copy: "Like no other campfire, it cranks out thigh-melting heat in wild winds, monsoon rains, and right in the middle of a burn ban."
- Key R4 selling point: BarCoal tubes glow red-hot and shoot infrared heat you can feel from 8 feet away. No other propane fire pit does this.

CRITICAL PRODUCT DISTINCTION:
- R1 = flames + moderate warmth + extreme portability + maximum efficiency. The "40°F fire."
- R4 MKii = thigh-melting radiant heat + flames + all-weather performance. The "0°F fire."
- Never over-promise R1 heat in cold-weather ads. The R1 is flames and light first, warmth second.
- The R4 is the one that makes people back their chairs up.

CUSTOMER LANGUAGE SWIPE FILE (from 938 real reviews — USE THESE PHRASES):

Thumbstop/Hook phrases customers actually use:
- "Your search for a campfire is over."
- "Nucking Futs!"
- "This thing cranks."
- "Built like a tank."
- "The only meaningful campfire in the entire canyon."
- "Feel it to believe it."
- "I almost didn't buy this."
- "Everyone walking by stopped for a little heat."
- "We would have froze without it."
- "Camping without a fire is lame."

Value justification phrases:
- "It's like my YETI cooler. Buy it once and have it for life."
- "One of my three all-time favorite gear purchases."
- "I'm already thinking that having only one is none, and two is one."
- "Worth every penny."
- "I'll be passing it down to my kids."
- "I gave my old fire pit to a friend and returned my smokeless fire pit."

Emotional/experiential phrases:
- "It changes everything for my family and enjoying the outdoors."
- "No more retreating to sleeping bags for warmth."
- "I've sat for hours staring at it looking for ways it could be improved. I gave up and just enjoyed it."
- "The fire is for the crew."
- "We can actually sit around it, talk, linger, and enjoy the moment."
- "If you love outdoors, this is outdoors."

Functional proof phrases:
- "No smoke, all the heat."
- "Still had a campfire at 6 degrees."
- "Even when the wind picked up it stayed lit."
- "Just turn off and go to bed. No worrying about hot coals."
- "No more searching for a place that sells firewood."
- "Cools down in under 10 minutes for transport."

OBJECTIONS TO PREEMPT (from negative reviews):
- "Not enough heat" (usually R1) → Set R1 expectations: flames + efficiency, not thigh-melting heat
- "Too expensive" → BIFL framing: compare to YETI, skis, mountain bike. Cost-per-campfire over 10+ years.
- "Too noisy" → Reframe: "Yeah, it's not silent. But neither is a wood fire crackling."
- "Uses too much propane" → Proactive usage education. BarCoal-only mode for extended, efficient burns.
- "Wind affects the flame" (R1) → Show it working in wind. Real conditions footage.
- "Heavy" (R4) → "Heavy means overbuilt. 27 lbs of stainless steel and aluminum. This isn't flimsy."

RULES FOR GENERATING AD COPY:
1. Respect character limits strictly for the specified platform.
2. No em dashes. Ever. Use periods, commas, or ellipses.
3. Write like a human at a campsite, not a brand in a boardroom.
4. Every headline must stop the scroll.
5. Vary sentence structure. Don't start every line the same way.
6. Use specific numbers and details (11 lbs, 1,300°F, 8 hours, 938 reviews, 90.4% five-star).
7. Pull directly from the customer language swipe file when it fits naturally.
8. Match the copy to the customer avatar if one is specified.
9. The emotional arc of "skeptic to evangelist" is the most powerful narrative in the review data. Use it.
10. Never say "game-changer" or "revolutionary." Those are dead words.`;
}

function buildUserPrompt(products, angles, platform, avatarId, copyCount, customContext) {
  const avatar = avatarId ? AVATARS.find((a) => a.id === avatarId) : null;
  const angleData = angles.map((a) => {
    const full = ANGLES.find((x) => x.id === a.id);
    return `- ${full.label}: ${full.desc}. Funnel position: ${full.funnel}. Customer language to channel: ${full.customerLanguage.map((l) => `"${l}"`).join(", ")}`;
  });

  return `Generate exactly ${copyCount} ad copy variations as a JSON array.

PRODUCTS TO FEATURE:
${products.map((p) => `- ${p.name} (${p.price}): ${p.tagline}. Key specs: ${p.specs.weight}, ${p.specs.opTemp} operating temp, ${p.specs.burnTime}, ${p.specs.materials}. ${p.brandCopy[0]}`).join("\n")}

PLATFORM: ${platform.label}
CHARACTER LIMITS:
- Headline: ${platform.charLimits.headline} chars max
- Primary text: ${platform.charLimits.primary} chars max
${platform.charLimits.description ? `- Description: ${platform.charLimits.description} chars max` : ""}

ANGLES TO USE (distribute evenly):
${angleData.join("\n")}

${avatar ? `TARGET AVATAR: ${avatar.label} — ${avatar.desc}. Best platforms: ${avatar.platforms}. Write copy that this specific person would stop scrolling for.` : ""}

${customContext ? `ADDITIONAL BRAND CONTEXT:\n${customContext}` : ""}

Each variation must be a JSON object:
- "product": "${products.map((p) => p.name).join('" or "')}"
- "angle": the angle label used
- "headline": the headline (STRICT char limit)
- "primary_text": primary/body text (STRICT char limit)
${platform.charLimits.description ? `- "description": description line (STRICT char limit)` : ""}
- "cta": short CTA (e.g. "Shop Now", "Get Yours", "Meet the R1")
${avatar ? `- "avatar": "${avatar.label}"` : ""}

Respond with ONLY the JSON array. No preamble, no markdown, no explanation.`;
}

// ═══════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function HowlAdEngine() {
  const [selectedProducts, setSelectedProducts] = useState(["r1", "r4mkii"]);
  const [selectedAngles, setSelectedAngles] = useState(["burn_ban", "skeptic", "heat"]);
  const [selectedPlatform, setSelectedPlatform] = useState("meta");
  const [selectedAvatar, setSelectedAvatar] = useState(null);
  const [copyCount, setCopyCount] = useState(10);
  const [customContext, setCustomContext] = useState("");
  const [variations, setVariations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("config");
  const [filterAngle, setFilterAngle] = useState("all");
  const [filterProduct, setFilterProduct] = useState("all");

  const toggleProduct = (id) => setSelectedProducts((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const toggleAngle = (id) => setSelectedAngles((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  const generate = async () => {
    if (selectedProducts.length === 0 || selectedAngles.length === 0) {
      setError("Select at least one product and one angle.");
      return;
    }
    setLoading(true);
    setError("");
    setVariations([]);

    const products = PRODUCTS.filter((p) => selectedProducts.includes(p.id));
    const angles = ANGLES.filter((a) => selectedAngles.includes(a.id));
    const platform = PLATFORMS.find((p) => p.id === selectedPlatform);

    try {
      const response = await fetch("/api/anthropic/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8000,
          system: buildSystemPrompt(),
          messages: [{ role: "user", content: buildUserPrompt(products, angles, platform, selectedAvatar, copyCount, customContext) }],
        }),
      });

      const data = await response.json();
      const text = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      const cleaned = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      setVariations(parsed);
      setActiveTab("results");
    } catch (err) {
      console.error(err);
      setError("Generation failed. Try again or reduce variation count.");
    } finally {
      setLoading(false);
    }
  };

  const exportCSV = () => {
    if (variations.length === 0) return;
    const keys = Object.keys(variations[0]);
    const header = keys.join(",");
    const rows = variations.map((v) => keys.map((k) => `"${(v[k] || "").replace(/"/g, '""')}"`).join(","));
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `howl_variations_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = variations.filter((v) => {
    if (filterAngle !== "all" && v.angle !== filterAngle) return false;
    if (filterProduct !== "all" && v.product !== filterProduct) return false;
    return true;
  });

  const platform = PLATFORMS.find((p) => p.id === selectedPlatform);
  const uniqueAngles = [...new Set(variations.map((v) => v.angle))];
  const uniqueProducts = [...new Set(variations.map((v) => v.product))];

  return (
    <div style={{ minHeight: "100vh", background: "#09090b", color: "#e4dfd6", fontFamily: "'JetBrains Mono', 'SF Mono', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Instrument+Serif&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #111; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }

        .hd { padding: 28px 36px 20px; border-bottom: 1px solid #1a1a1a; display: flex; align-items: center; justify-content: space-between; }
        .hd-logo { font-size: 12px; font-weight: 700; letter-spacing: 6px; text-transform: uppercase; color: #f5f0e8; }
        .hd-logo b { color: #d94f2b; }
        .hd-sub { font-size: 9px; letter-spacing: 2px; color: #444; text-transform: uppercase; padding: 3px 8px; border: 1px solid #1f1f1f; }

        .tabs { display: flex; border-bottom: 1px solid #1a1a1a; }
        .tab { padding: 13px 28px; font-family: inherit; font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: #444; cursor: pointer; border: none; background: none; border-bottom: 2px solid transparent; transition: all .2s; }
        .tab:hover { color: #888; }
        .tab.on { color: #d94f2b; border-bottom-color: #d94f2b; }

        .body { padding: 28px 36px; max-width: 1280px; }
        .sect { margin-bottom: 32px; }
        .slbl { font-size: 9px; letter-spacing: 3px; text-transform: uppercase; color: #3a3a3a; margin-bottom: 12px; }

        .chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .chip { padding: 9px 14px; border: 1px solid #1e1e1e; background: #111; color: #666; font-family: inherit; font-size: 11px; cursor: pointer; transition: all .15s; }
        .chip:hover { border-color: #2a2a2a; color: #aaa; }
        .chip.on { border-color: #d94f2b; color: #f0e8de; background: #1a0e0a; }
        .chip-sub { display: block; font-size: 9px; color: #3a3a3a; margin-top: 2px; }
        .chip.on .chip-sub { color: #7a4a3a; }

        .agrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 6px; }
        .acard { padding: 12px 14px; border: 1px solid #1e1e1e; background: #111; cursor: pointer; transition: all .15s; }
        .acard:hover { border-color: #2a2a2a; }
        .acard.on { border-color: #d94f2b; background: #1a0e0a; }
        .acard .em { font-size: 16px; margin-bottom: 4px; }
        .acard .nm { font-size: 11px; font-weight: 500; color: #888; }
        .acard.on .nm { color: #f0e8de; }
        .acard .ds { font-size: 9px; color: #3a3a3a; margin-top: 3px; line-height: 1.4; }
        .acard.on .ds { color: #7a4a3a; }
        .acard .fn { font-size: 8px; color: #2a2a2a; margin-top: 4px; letter-spacing: 1px; text-transform: uppercase; }
        .acard.on .fn { color: #5a3a2a; }

        .avgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 6px; }
        .avcard { padding: 10px 12px; border: 1px solid #1e1e1e; background: #111; cursor: pointer; transition: all .15s; font-size: 11px; color: #666; }
        .avcard:hover { border-color: #2a2a2a; }
        .avcard.on { border-color: #d94f2b; background: #1a0e0a; color: #f0e8de; }
        .avcard .avd { font-size: 9px; color: #3a3a3a; margin-top: 3px; line-height: 1.3; }
        .avcard.on .avd { color: #7a4a3a; }

        .cntbtn { padding: 9px 18px; border: 1px solid #1e1e1e; background: #111; color: #666; font-family: inherit; font-size: 12px; cursor: pointer; transition: all .15s; }
        .cntbtn:hover { border-color: #2a2a2a; }
        .cntbtn.on { border-color: #d94f2b; color: #f0e8de; background: #1a0e0a; }

        .ta { width: 100%; background: #111; border: 1px solid #1e1e1e; color: #bbb; font-family: inherit; font-size: 11px; padding: 12px 14px; resize: vertical; min-height: 70px; outline: none; transition: border-color .2s; }
        .ta:focus { border-color: #d94f2b; }
        .ta::placeholder { color: #2a2a2a; }

        .gobtn { padding: 14px 36px; background: #d94f2b; border: none; color: #fff; font-family: inherit; font-size: 11px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; cursor: pointer; transition: all .2s; }
        .gobtn:hover { background: #e05a36; }
        .gobtn:disabled { background: #1e1e1e; color: #333; cursor: not-allowed; }

        .xbtn { padding: 10px 22px; background: none; border: 1px solid #d94f2b; color: #d94f2b; font-family: inherit; font-size: 10px; font-weight: 500; letter-spacing: 2px; text-transform: uppercase; cursor: pointer; transition: all .2s; }
        .xbtn:hover { background: #1a0e0a; }

        .err { padding: 10px 14px; border: 1px solid #5c1a1a; background: #1a0a0a; color: #d94f2b; font-size: 11px; margin-bottom: 16px; }
        .spin { display: inline-block; width: 16px; height: 16px; border: 2px solid #1e1e1e; border-top-color: #d94f2b; border-radius: 50%; animation: sp .7s linear infinite; margin-right: 10px; vertical-align: middle; }
        @keyframes sp { to { transform: rotate(360deg); } }
        .ldg { padding: 32px 0; color: #444; font-size: 11px; }

        .srow { display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
        .sbox { padding: 14px 18px; border: 1px solid #1a1a1a; background: #0e0e0e; min-width: 120px; }
        .sbox .sv { font-size: 22px; font-weight: 700; color: #f0e8de; }
        .sbox .sl { font-size: 8px; letter-spacing: 2px; text-transform: uppercase; color: #3a3a3a; margin-top: 3px; }

        .rhead { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px; }
        .rcnt { font-size: 10px; letter-spacing: 2px; color: #444; text-transform: uppercase; }
        .filters { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
        .fbtn { padding: 5px 10px; border: 1px solid #1e1e1e; background: #111; color: #555; font-family: inherit; font-size: 9px; cursor: pointer; transition: all .15s; letter-spacing: 1px; }
        .fbtn:hover { border-color: #2a2a2a; }
        .fbtn.on { border-color: #d94f2b; color: #d94f2b; background: #1a0e0a; }

        .cgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; }
        .card { border: 1px solid #161616; background: #0c0c0c; padding: 18px; position: relative; transition: border-color .2s; }
        .card:hover { border-color: #242424; }
        .cmeta { display: flex; justify-content: space-between; margin-bottom: 12px; }
        .ctag { font-size: 8px; letter-spacing: 2px; text-transform: uppercase; padding: 2px 7px; border: 1px solid #1e1e1e; color: #444; }
        .ctag.prod { border-color: rgba(217,79,43,0.3); color: #d94f2b; }
        .chl { font-family: 'Instrument Serif', serif; font-size: 20px; color: #f5f0e8; line-height: 1.25; margin-bottom: 8px; font-weight: 400; }
        .cbody { font-size: 11px; color: #777; line-height: 1.6; margin-bottom: 6px; }
        .cdesc { font-size: 10px; color: #444; font-style: italic; }
        .ccta { margin-top: 10px; font-size: 9px; letter-spacing: 2px; text-transform: uppercase; color: #d94f2b; font-weight: 500; }
        .cnum { position: absolute; top: 6px; right: 10px; font-size: 8px; color: #1a1a1a; }
      `}</style>

      <div className="hd">
        <div className="hd-logo"><b>HOWL</b> / Ad Engine</div>
        <div className="hd-sub">938 Reviews × Claude</div>
      </div>

      <div className="tabs">
        <button className={`tab ${activeTab === "config" ? "on" : ""}`} onClick={() => setActiveTab("config")}>Configure</button>
        <button className={`tab ${activeTab === "results" ? "on" : ""}`} onClick={() => setActiveTab("results")} disabled={variations.length === 0}>
          Results {variations.length > 0 && `(${variations.length})`}
        </button>
      </div>

      {activeTab === "config" && (
        <div className="body">
          {error && <div className="err">{error}</div>}

          <div className="sect">
            <div className="slbl">Products</div>
            <div className="chips">
              {PRODUCTS.map((p) => (
                <div key={p.id} className={`chip ${selectedProducts.includes(p.id) ? "on" : ""}`} onClick={() => toggleProduct(p.id)}>
                  <strong>{p.name}</strong> — {p.price}
                  <span className="chip-sub">{p.subtitle}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="sect">
            <div className="slbl">Platform</div>
            <div className="chips">
              {PLATFORMS.map((p) => (
                <div key={p.id} className={`chip ${selectedPlatform === p.id ? "on" : ""}`} onClick={() => setSelectedPlatform(p.id)}>
                  {p.label}
                </div>
              ))}
            </div>
          </div>

          <div className="sect">
            <div className="slbl">Creative Angles (from 938 reviews)</div>
            <div className="agrid">
              {ANGLES.map((a) => (
                <div key={a.id} className={`acard ${selectedAngles.includes(a.id) ? "on" : ""}`} onClick={() => toggleAngle(a.id)}>
                  <div className="em">{a.icon}</div>
                  <div className="nm">{a.label}</div>
                  <div className="ds">{a.desc}</div>
                  <div className="fn">{a.funnel}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="sect">
            <div className="slbl">Target Avatar (optional)</div>
            <div className="avgrid">
              <div className={`avcard ${selectedAvatar === null ? "on" : ""}`} onClick={() => setSelectedAvatar(null)}>
                All audiences
                <div className="avd">No specific persona targeting</div>
              </div>
              {AVATARS.map((a) => (
                <div key={a.id} className={`avcard ${selectedAvatar === a.id ? "on" : ""}`} onClick={() => setSelectedAvatar(a.id)}>
                  {a.label}
                  <div className="avd">{a.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="sect">
            <div className="slbl">Variations</div>
            <div className="chips">
              {COPY_COUNT_OPTIONS.map((n) => (
                <button key={n} className={`cntbtn ${copyCount === n ? "on" : ""}`} onClick={() => setCopyCount(n)}>{n}</button>
              ))}
            </div>
          </div>

          <div className="sect">
            <div className="slbl">Additional Context (optional)</div>
            <textarea className="ta" placeholder="e.g. We're running a Memorial Day sale... Focus on the R4 MKii upgrade... Target ski bums in Colorado..." value={customContext} onChange={(e) => setCustomContext(e.target.value)} />
          </div>

          <button className="gobtn" onClick={generate} disabled={loading || selectedProducts.length === 0 || selectedAngles.length === 0}>
            {loading ? "Generating..." : `Generate ${copyCount} Variations`}
          </button>
          {loading && <div className="ldg"><span className="spin" /> Claude is writing your ad copy using real customer language...</div>}
        </div>
      )}

      {activeTab === "results" && variations.length > 0 && (
        <div className="body">
          <div className="srow">
            <div className="sbox"><div className="sv">{variations.length}</div><div className="sl">Variations</div></div>
            <div className="sbox"><div className="sv">{uniqueAngles.length}</div><div className="sl">Angles</div></div>
            <div className="sbox"><div className="sv">{uniqueProducts.length}</div><div className="sl">Products</div></div>
            <div className="sbox"><div className="sv">{platform.label}</div><div className="sl">Platform</div></div>
          </div>

          <div className="rhead">
            <div className="filters">
              <span style={{ fontSize: 9, letterSpacing: 2, color: "#333", textTransform: "uppercase", marginRight: 4 }}>Filter:</span>
              <button className={`fbtn ${filterAngle === "all" ? "on" : ""}`} onClick={() => setFilterAngle("all")}>All Angles</button>
              {uniqueAngles.map((a) => (
                <button key={a} className={`fbtn ${filterAngle === a ? "on" : ""}`} onClick={() => setFilterAngle(a)}>{a}</button>
              ))}
              <span style={{ width: 1, height: 16, background: "#1e1e1e", display: "inline-block", margin: "0 4px" }} />
              <button className={`fbtn ${filterProduct === "all" ? "on" : ""}`} onClick={() => setFilterProduct("all")}>All Products</button>
              {uniqueProducts.map((p) => (
                <button key={p} className={`fbtn ${filterProduct === p ? "on" : ""}`} onClick={() => setFilterProduct(p)}>{p}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="xbtn" onClick={exportCSV}>Export CSV → Figma</button>
            </div>
          </div>

          <div className="rcnt">{filtered.length} of {variations.length} showing</div>

          <div className="cgrid" style={{ marginTop: 12 }}>
            {filtered.map((v, i) => (
              <div className="card" key={i}>
                <div className="cnum">#{String(i + 1).padStart(2, "0")}</div>
                <div className="cmeta">
                  <span className="ctag prod">{v.product}</span>
                  <span className="ctag">{v.angle}</span>
                </div>
                <div className="chl">{v.headline}</div>
                <div className="cbody">{v.primary_text}</div>
                {v.description && <div className="cdesc">{v.description}</div>}
                <div className="ccta">{v.cta} →</div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 28, display: "flex", gap: 10 }}>
            <button className="xbtn" onClick={exportCSV}>Export CSV → Figma</button>
            <button className="xbtn" onClick={() => setActiveTab("config")}>← Configure</button>
            <button className="xbtn" onClick={generate}>↻ Regenerate</button>
          </div>
        </div>
      )}
    </div>
  );
}
