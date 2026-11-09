const TYPE_ICONS = {
  "Full Set": "🛡", Sword: "⚔", Katana: "🗡", Axe: "🪓", Mace: "🔨",
  Polearm: "🔱", Dagger: "🔪", Fist: "✊", Scythe: "☠", Pickaxe: "⛏",
  Shovel: "🛠", Shield: "🛡", Trident: "🔱", Staff: "🪄",
  Helmet: "⛑", Chestplate: "🦺", Leggings: "👖", Boots: "🥾"
};

const WORK_ICONS = {
  sword: "⚔", axe: "🪓", spear: "🔱", mace: "🔨", hoe: "☠",
  pickaxe: "⛏", shovel: "🛠", shield: "🛡", trident: "🔱",
  helmet: "⛑", chestplate: "🦺", leggings: "👖", boots: "🥾"
};

const RARITY_ORDER = ["uncommon","common","rare","special","epic","legendary","unique"];
const RARITY_ALIASES = { superior: "rare", exquisite: "epic" };

const ARMOR_TYPES = ["Full Set"];
const ARMOR_PIECES = [
  { id: "helmet", label: "Helmets" },
  { id: "chestplate", label: "Chestplates" },
  { id: "leggings", label: "Leggings" },
  { id: "boots", label: "Boots" },
];
let pieceFilter = "all";
const WEAPON_TYPES = ["Sword","Katana","Axe","Mace","Polearm","Dagger","Fist","Scythe","Pickaxe","Shovel","Shield","Trident","Staff"];

let items = [];
let groupFilter = "all";
let typeFilter = "all";
let rarityFilter = "all";
let sourceFilter = "all";

const $ = (id) => document.getElementById(id);

fetch("data/database.json")
  .then((r) => {
    if (!r.ok) throw new Error("HTTP " + r.status + " for data/database.json");
    return r.json();
  })
  .then((data) => {
    items = Array.isArray(data) ? data : [];
    if (!items.length) console.warn("database.json is empty");
    buildSource();
    buildRarity();
    rebuildTypeChips();
    render();
    startHero();
  })
  .catch((e) => {
    const empty = $("empty");
    if (empty) {
      empty.textContent = "Could not load data/database.json — use a local server (python -m http.server)";
      empty.classList.remove("hidden");
    }
    console.error("database load failed", e);
  });

function normalizeRarity(r) {
  const x = (r || "common").toLowerCase().trim();
  return RARITY_ALIASES[x] || x;
}
function labelRarity(r) {
  const n = normalizeRarity(r);
  return n.charAt(0).toUpperCase() + n.slice(1);
}

function typesForGroup() {
  const armorOrder = ["Full Set", "Helmet", "Chestplate", "Leggings", "Boots"];
  const armorPieces = ["Helmet", "Chestplate", "Leggings", "Boots"];
  if (groupFilter === "armor") return armorOrder.filter((t) => items.some((i) => i.type === t));
  if (groupFilter === "weapon") return WEAPON_TYPES.filter((t) => items.some((i) => i.type === t));
  // All: weapon types + Full Set only (no separate piece filters)
  const all = [...new Set(items.map((i) => i.type).filter(Boolean))]
    .filter((t) => !armorPieces.includes(t));
  const order = ["Full Set", ...WEAPON_TYPES];
  return all.sort((a, b) => {
    const ia = order.indexOf(a); const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
}

function rebuildTypeChips() {
  const box = $("type-filters");
  box.innerHTML = "";
  const make = (value, label, active, kind) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (active ? " active" : "");
    if (kind === "piece") b.dataset.piece = value;
    else b.dataset.type = value;
    b.textContent = label;
    b.onclick = () => {
      box.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      b.classList.add("active");
      if (kind === "piece") {
        pieceFilter = value;
        typeFilter = "all";
      } else {
        typeFilter = value;
        pieceFilter = "all";
      }
      render();
    };
    box.appendChild(b);
  };
  if (groupFilter === "armor") {
    make("all", "All armor", pieceFilter === "all" && typeFilter === "all", "piece");
    make("Full Set", "Full sets", typeFilter === "Full Set", "type");
    ARMOR_PIECES.forEach((p) => make(p.id, p.label, pieceFilter === p.id, "piece"));
  } else {
    pieceFilter = "all";
    make("all", "All", typeFilter === "all", "type");
    typesForGroup().forEach((t) => make(t, t, typeFilter === t, "type"));
    if (typeFilter !== "all" && !typesForGroup().includes(typeFilter)) typeFilter = "all";
  }
}

function buildRarity() {
  const box = $("rarity-filters");
  box.innerHTML = "";
  const make = (value, label, active) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (active ? " active" : "");
    b.dataset.rarity = value;
    b.textContent = label;
    b.onclick = () => {
      box.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      b.classList.add("active");
      rarityFilter = value;
      render();
    };
    box.appendChild(b);
  };
  make("all", "All rarities", true);
  RARITY_ORDER.forEach((r) => make(r, r.charAt(0).toUpperCase() + r.slice(1), false));
}

function buildSource() {
  const sources = [...new Set(items.map((i) => i.source).filter(Boolean))].sort();
  const sel = $("source-filter");
  sources.forEach((s) => {
    const o = document.createElement("option");
    o.value = s;
    o.textContent = s;
    sel.appendChild(o);
  });
  sel.onchange = () => { sourceFilter = sel.value; render(); };
}

document.querySelectorAll("#group-filters .group-btn").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll("#group-filters .group-btn").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    groupFilter = btn.dataset.group;
    typeFilter = "all";
    pieceFilter = "all";
    rebuildTypeChips();
    render();
  };
});

$("search").addEventListener("input", render);

function filtered() {
  const q = $("search").value.trim().toLowerCase();
  return items.filter((item) => {
    if (groupFilter !== "all" && item.group !== groupFilter) return false;
    // On All: show weapons + Full Set only (not every armor piece)
    if (groupFilter === "all" && item.group === "armor" && item.type !== "Full Set") return false;
    // Piece categories must match exact type (never show Full Set under Chestplates etc.)
    if (typeFilter !== "all") {
      if (item.type !== typeFilter) return false;
    }
    // Legacy pieceFilter on works_on — only when type is all, still exclude Full Set if filtering a piece slot
    if (typeof pieceFilter !== "undefined" && pieceFilter !== "all") {
      if (item.type === "Full Set") return false;
      const works = item.works_on || [];
      if (!works.includes(pieceFilter)) return false;
    }
    if (sourceFilter !== "all" && item.source !== sourceFilter) return false;
    if (rarityFilter !== "all" && normalizeRarity(item.rarity) !== rarityFilter) return false;
    if (!q) return true;
    const hay = [item.name, item.type, item.source, item.rarity, ...(item.works_on || [])].join(" ").toLowerCase();
    return hay.includes(q);
  });
}

function render() {
  const list = filtered();
  const box = $("items");
  box.innerHTML = "";
  $("result-count").textContent = `${list.length} items`;
  $("empty").classList.toggle("hidden", list.length > 0);
  list.forEach((item) => {
    const card = document.createElement("article");
    card.className = "card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    const icon = TYPE_ICONS[item.type] || "✦";
    const rarity = normalizeRarity(item.rarity);
    const thumb = item.thumbnail
      ? `<img class="card-thumb" src="${escapeHtml(item.thumbnail)}" alt="" loading="lazy" />`
      : `<div class="card-icon">${icon}</div>`;
    card.innerHTML = `
      ${thumb}
      <h3>${escapeHtml(item.name)}</h3>
      <div class="meta">${escapeHtml(item.type || "")}</div>
      <div class="badge-row"><span class="badge r-${rarity}">${escapeHtml(labelRarity(item.rarity))}</span></div>
    `;
    card.onclick = () => openModal(item);
    card.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openModal(item); } };
    box.appendChild(card);
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function openModal(item) {
  $("modal-title").textContent = item.name;
  $("modal-rarity").textContent = labelRarity(item.rarity);
  $("modal-type").textContent = item.type || "";
  $("modal-source").textContent = item.source ? `Source: ${item.source}` : "";
  const prev = $("modal-preview");
  prev.innerHTML = "";
  const thumb = item.thumbnail;
  const gltf = item.gltf || (item.id ? `models/${item.id}.gltf` : null);
  const showFallback = () => {
    if (thumb) prev.innerHTML = `<img src="${escapeHtml(thumb)}" alt="" />`;
    else prev.textContent = TYPE_ICONS[item.type] || "✦";
  };
  if (gltf) {
    // Dynamic import so catalog still works if Three.js CDN fails
    import("./viewer.js")
      .then((mod) => mod.openViewer(prev, gltf, thumb))
      .catch((err) => {
        console.warn("3D viewer unavailable", err);
        showFallback();
      });
  } else {
    showFallback();
  }
  const works = $("works-icons");
  works.innerHTML = "";
  (item.works_on || []).forEach((w) => {
    const el = document.createElement("span");
    el.className = "work-icon";
    el.textContent = WORK_ICONS[w] || "•";
    el.dataset.tip = w;
    el.title = w;
    works.appendChild(el);
  });
  const copyName = item.copy_name || item.name;
  $("copy-btn").onclick = async () => {
    try {
      await navigator.clipboard.writeText(copyName);
      const t = $("copy-toast");
      t.classList.remove("hidden");
      setTimeout(() => t.classList.add("hidden"), 1600);
    } catch {
      prompt("Copy this name:", copyName);
    }
  };
  $("modal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  import("./viewer.js").then((mod) => mod.closeViewer()).catch(() => {});
  $("modal").classList.add("hidden");
  document.body.style.overflow = "";
}
$("modal").addEventListener("click", (e) => { if (e.target.hasAttribute("data-close")) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

function startHero() {
  const pool = items.filter((i) => i.group === "weapon");
  if (!pool.length) return;
  const pick = () => pool[Math.floor(Math.random() * pool.length)];
  const show = () => {
    const it = pick();
    $("hero-spin").textContent = TYPE_ICONS[it.type] || "⚔";
    $("hero-label").textContent = it.name;
  };
  show();
  setInterval(show, 4000);
}
