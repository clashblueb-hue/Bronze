


const GRID_COLUMNS = 5;
const INITIAL_PLOTS = 10;
const EXPANSION_SIZE = 5;
const MAX_PLOTS = 35;
const MAX_CLICK_BURST = 8;
const MAX_CLICK_POWER = 6;


const resources = [
  { key: "influence", label: "Influence", short: "Influence" },
  { key: "wood", label: "Wood", short: "Wood" },
  { key: "stone", label: "Stone", short: "Stone" },
  { key: "metal", label: "Metal", short: "Metal" },
  { key: "knowledge", label: "Knowledge", short: "Knowledge" },
];

let state = null;
let dirty = false;
let saving = false;
let lastFullRender = 0;
function createEmptyResourceMap() {
  return Object.fromEntries(resources.map((resource) => [resource.key, 0]));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function formatNumber(value) {
  if (value >= 1000000000) return `${(value / 1000000000).toFixed(2)}B`;
  if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(2)}K`;
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2).replace(/\.00$/, "");
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  return `${minutes}m ${String(remaining).padStart(2, "0")}s`;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}



function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[character];
  });
}

function formatCostPills(cost) {
  return resources
    .filter((resource) => cost[resource.key])
    .map((resource) => {
      const enough = state.resources[resource.key] + 1e-9 >= cost[resource.key];
      return `<span class="cost-pill ${enough ? "" : "missing"}">${formatNumber(cost[resource.key])} ${resource.short}</span>`;
    })
    .join("");
}

function canAfford(cost) {
  return resources.every((resource) => state.resources[resource.key] + 1e-9 >= (cost[resource.key] || 0));
}

function spendResources(cost) {
  for (const resource of resources) {
    const amount = cost[resource.key] || 0;
    if (amount > 0) {
      state.resources[resource.key] -= amount;
    }
  }
}

function addResources(delta) {
  for (const resource of resources) {
    state.resources[resource.key] += delta[resource.key] || 0;
  }
}

function addLog(text) {
  state.log.unshift({ time: Date.now(), text });
  state.log = state.log.slice(0, 12);
}

function createExplorer(name, type = "adventurer") {
  return {
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    type,
    archetype: "scout",
    cloak: "ember",
    accent: "bronze",
    xp: 0,
    crafted: Object.fromEntries(gearRecipes.map((item) => [item.id, false])),
    equippedWeapon: null,
    equippedArmor: null,
    mission: null,
  };
}

function createInitialState() {
  const grid = Array(INITIAL_PLOTS).fill(null);
  grid[2] = "banner_camp";
  const mainExplorer = createExplorer("ari", "adventurer");

  return {
    version: 4,
    activeTab: "clicker",
    age: 0,
    totalClicks: 0,
    mapExpansions: 0,
    pendingBuild: null,
    lastTick: Date.now(),
    resources: { influence: 80, wood: 0, stone: 0, metal: 0, knowledge: 0 },
    workers: { total: 0, assignments: createEmptyResourceMap() },
    army: { warriors: 0 },
    clicker: { theme: "sun", burstLevel: 1, powerLevel: 0 },
    grid,
    explorers: {
      selectedId: mainExplorer.id,
      roster: [mainExplorer],
    },
    world: {
      elapsedSeconds: 0,
      villageScoutUnlockAt: randomInt(300, 600),
      villageScoutsUnlocked: false,
      villages: [],
      raid: {
        enabled: false,
        nextRaidAt: null,
        wavesSurvived: 0,
        lastRaid: null,
      },
    },
    log: [{ time: Date.now(), text: "A new banner camp rises. Influence is your only resource for now." }],
  };
}

function normalizeState(raw) {
  if (!raw || raw.version !== 4) {
    return createInitialState();
  }

  const initial = createInitialState();
  const merged = {
    ...initial,
    ...raw,
    resources: { ...initial.resources, ...(raw.resources || {}) },
    workers: {
      total: raw.workers?.total ?? initial.workers.total,
      assignments: { ...initial.workers.assignments, ...(raw.workers?.assignments || {}) },
    },
    army: { ...initial.army, ...(raw.army || {}) },
    clicker: { ...initial.clicker, ...(raw.clicker || {}) },
    explorers: {
      selectedId: raw.explorers?.selectedId || initial.explorers.selectedId,
      roster: Array.isArray(raw.explorers?.roster) && raw.explorers.roster.length
        ? raw.explorers.roster.map((explorer) => ({
            ...createExplorer("temp"),
            ...explorer,
            crafted: { ...Object.fromEntries(gearRecipes.map((item) => [item.id, false])), ...(explorer.crafted || {}) },
          }))
        : initial.explorers.roster,
    },
    world: {
      ...initial.world,
      ...(raw.world || {}),
      raid: { ...initial.world.raid, ...(raw.world?.raid || {}) },
      villages: Array.isArray(raw.world?.villages) ? raw.world.villages : initial.world.villages,
    },
    grid: Array.isArray(raw.grid) ? raw.grid.slice() : initial.grid.slice(),
    log: Array.isArray(raw.log) && raw.log.length ? raw.log : initial.log,
  };

  if (!merged.explorers.roster.some((explorer) => explorer.id === merged.explorers.selectedId)) {
    merged.explorers.selectedId = merged.explorers.roster[0].id;
  }

  clampAssignments(merged);
  return merged;
}

function saveOffline() {
  if (!state) return;

  localStorage.setItem(
    "bronzeBannerOfflineSave",
    JSON.stringify(state)
  );
}

function loadOffline() {
  const raw = localStorage.getItem("bronzeBannerOfflineSave");

  if (!raw) {
    return createInitialState();
  }

  try {
    return normalizeState(JSON.parse(raw));
  } catch {
    return createInitialState();
  }
}

function markDirty() {
  dirty = true;
}

function flushSave() {
  saveOffline();
  dirty = false;
}

UI.manualSaveButton.addEventListener("click", () => {
  saveOffline();
  addLog("Game saved locally.");
  renderAll();
});

function getBuildingDefinition(id) {
  return buildingDefs.find((building) => building.id === id) || null;
}

function getBuildingCounts(sourceState = state) {
  const counts = Object.fromEntries(buildingDefs.map((building) => [building.id, 0]));
  for (const id of sourceState.grid) {
    if (id && counts[id] !== undefined) {
      counts[id] += 1;
    }
  }
  return counts;
}

function getTotalBuildings(sourceState = state) {
  return sourceState.grid.filter(Boolean).length;
}

function getOpenPlots(sourceState = state) {
  return sourceState.grid.filter((entry) => !entry).length;
}

function getWorkerCapacity(sourceState = state) {
  return sourceState.grid.reduce((sum, id) => {
    const building = getBuildingDefinition(id);
    return sum + (building?.workerCap || 0);
  }, 0);
}

function getJobCaps(sourceState = state) {
  const caps = createEmptyResourceMap();
  for (const id of sourceState.grid) {
    const building = getBuildingDefinition(id);
    if (!building) {
      continue;
    }
    for (const [key, amount] of Object.entries(building.jobSlots || {})) {
      caps[key] += amount;
    }
  }
  return caps;
}

function clampAssignments(sourceState = state) {
  const caps = getJobCaps(sourceState);
  let assigned = 0;

  for (const job of jobs) {
    const current = sourceState.workers.assignments[job.key] || 0;
    const clamped = Math.max(0, Math.min(current, caps[job.key]));
    sourceState.workers.assignments[job.key] = clamped;
    assigned += clamped;
  }

  if (assigned <= sourceState.workers.total) {
    return;
  }

  let overflow = assigned - sourceState.workers.total;
  for (const job of [...jobs].reverse()) {
    if (overflow <= 0) {
      break;
    }
    const current = sourceState.workers.assignments[job.key];
    const reduction = Math.min(current, overflow);
    sourceState.workers.assignments[job.key] -= reduction;
    overflow -= reduction;
  }
}

function getAssignedWorkers() {
  return jobs.reduce((sum, job) => sum + (state.workers.assignments[job.key] || 0), 0);
}

function getIdleWorkers() {
  return Math.max(0, state.workers.total - getAssignedWorkers());
}

function getAgeBonuses() {
  let clickMultiplier = 1;
  let workerMultiplier = 1;
  let globalMultiplier = 1;

  if (state.age >= 1) clickMultiplier *= 1.15;
  if (state.age >= 2) workerMultiplier *= 1.15;
  if (state.age >= 3) clickMultiplier *= 1.2;
  if (state.age >= 4) globalMultiplier *= 1.25;

  return { clickMultiplier, workerMultiplier, globalMultiplier };
}

function getClickBurstUpgradeCost() {
  const nextLevel = state.clicker.burstLevel;
  return {
    influence: Math.ceil(55 * 1.55 ** (nextLevel - 1)),
    wood: nextLevel >= 3 ? Math.ceil(18 * 1.5 ** (nextLevel - 3)) : 0,
    stone: nextLevel >= 5 ? Math.ceil(14 * 1.45 ** (nextLevel - 5)) : 0,
  };
}

function getClickPowerUpgradeCost() {
  const nextLevel = state.clicker.powerLevel + 1;
  return {
    influence: Math.ceil(40 * 1.45 ** (nextLevel - 1)),
    wood: nextLevel >= 2 ? Math.ceil(12 * 1.45 ** (nextLevel - 2)) : 0,
    knowledge: nextLevel >= 4 ? Math.ceil(10 * 1.35 ** (nextLevel - 4)) : 0,
  };
}

function getClickPowerMultiplier() {
  return 1 + state.clicker.powerLevel * 0.35;
}

function isClickerUnlocked(resourceKey) {
  const clicker = clickerDefs.find((entry) => entry.key === resourceKey);
  if (!clicker) return false;
  if (!clicker.unlockBuilding) return true;
  return getBuildingCounts()[clicker.unlockBuilding] > 0;
}

function getClickYield(resourceKey) {
  const clicker = clickerDefs.find((entry) => entry.key === resourceKey);
  if (!clicker || !isClickerUnlocked(resourceKey)) return 0;
  const bonuses = getAgeBonuses();
  return (
    clicker.yield *
    state.clicker.burstLevel *
    getClickPowerMultiplier() *
    bonuses.clickMultiplier *
    bonuses.globalMultiplier
  );
}

function getProductionPerSecond() {
  const totals = createEmptyResourceMap();
  const caps = getJobCaps();
  const bonuses = getAgeBonuses();

  for (const job of jobs) {
    const assigned = Math.min(state.workers.assignments[job.key] || 0, caps[job.key] || 0);
    totals[job.key] += assigned * job.rate * bonuses.workerMultiplier * bonuses.globalMultiplier;
  }

  return totals;
}

function getHireCost() {
  return { influence: Math.ceil(18 * 1.22 ** state.workers.total + state.workers.total * 3) };
}

function getWarriorCost() {
  return {
    influence: Math.ceil(70 * 1.22 ** state.army.warriors),
    wood: Math.ceil(24 * 1.18 ** state.army.warriors),
    stone: state.army.warriors >= 2 ? Math.ceil(10 * 1.16 ** (state.army.warriors - 2)) : 0,
  };
}

function getMapExpansionCost() {
  return {
    influence: Math.ceil(140 * 1.6 ** state.mapExpansions),
    wood: Math.ceil(65 * 1.48 ** state.mapExpansions),
    stone: state.mapExpansions >= 1 ? Math.ceil(28 * 1.45 ** (state.mapExpansions - 1)) : 0,
  };
}

function getRecruitExplorerCost() {
  const adventurers = state.explorers.roster.filter((explorer) => explorer.type === "adventurer").length;
  return {
    influence: Math.ceil(120 * 1.28 ** Math.max(0, adventurers - 1)),
    wood: Math.ceil(40 * 1.2 ** Math.max(0, adventurers - 1)),
  };
}

function getRecruitVillageScoutCost() {
  const scouts = state.explorers.roster.filter((explorer) => explorer.type === "village_scout").length;
  return {
    influence: Math.ceil(180 * 1.32 ** scouts),
    wood: Math.ceil(70 * 1.24 ** scouts),
    stone: Math.ceil(24 * 1.2 ** scouts),
  };
}

function getNextAge() {
  return ages[state.age + 1] || null;
}

function canAdvanceAge() {
  const nextAge = getNextAge();
  if (!nextAge) return false;
  return canAfford(nextAge.cost) && getTotalBuildings() >= nextAge.minBuildings;
}

function getAgeProgress() {
  const nextAge = getNextAge();
  if (!nextAge) return 1;
  const checks = [];

  for (const resource of resources) {
    const needed = nextAge.cost[resource.key] || 0;
    if (needed > 0) checks.push(Math.min(state.resources[resource.key] / needed, 1));
  }

  checks.push(Math.min(getTotalBuildings() / nextAge.minBuildings, 1));
  return checks.reduce((sum, value) => sum + value, 0) / checks.length;
}

function getExplorerById(id) {
  return state.explorers.roster.find((explorer) => explorer.id === id) || null;
}

function getSelectedExplorer() {
  return getExplorerById(state.explorers.selectedId) || state.explorers.roster[0];
}

function getExplorerLevel(explorer) {
  let level = 1;
  let remaining = explorer.xp;
  while (remaining >= level * 100) {
    remaining -= level * 100;
    level += 1;
  }
  return level;
}

function getExplorerProgress(explorer) {
  const level = getExplorerLevel(explorer);
  let spent = 0;
  for (let index = 1; index < level; index += 1) {
    spent += index * 100;
  }
  const intoLevel = explorer.xp - spent;
  const needed = level * 100;
  return { level, intoLevel, needed, percent: Math.min(intoLevel / needed, 1) };
}

function getRecipe(id) {
  return gearRecipes.find((recipe) => recipe.id === id) || null;
}

function getEquippedRecipe(explorer, slot) {
  const id = slot === "weapon" ? explorer.equippedWeapon : explorer.equippedArmor;
  return id ? getRecipe(id) : null;
}

function getExplorerPower(explorer) {
  const weaponPower = getEquippedRecipe(explorer, "weapon")?.power || 0;
  const armorPower = getEquippedRecipe(explorer, "armor")?.power || 0;
  return getExplorerLevel(explorer) + weaponPower + armorPower;
}

function isInstantExplorer(explorer) {
  return explorer.name === "mrbeast6000";
}

function isExpeditionUnlocked(expedition, explorer) {
  if (getExplorerLevel(explorer) < expedition.minLevel) return false;
  if (expedition.requiredWeapon && !explorer.crafted[expedition.requiredWeapon]) return false;
  if (expedition.requiredArmor && !explorer.crafted[expedition.requiredArmor]) return false;
  return true;
}

function buildRewardMap(rewardDefinition, rewardMultiplier = 1) {
  const rewards = createEmptyResourceMap();
  for (const resource of resources) {
    const range = rewardDefinition[resource.key];
    if (!range) continue;
    const amount = range[0] + Math.random() * (range[1] - range[0]);
    rewards[resource.key] = Math.round(amount * rewardMultiplier);
  }
  return rewards;
}

function getVillageSupportStrength() {
  return state.world.villages.reduce((sum, village) => sum + village.support * 3, 0);
}

function scheduleNextRaid() {
  state.world.raid.nextRaidAt = state.world.elapsedSeconds + randomInt(600, 1200);
}

function applyProduction(seconds) {
  if (seconds <= 0) return;
  const perSecond = getProductionPerSecond();
  const delta = createEmptyResourceMap();
  for (const resource of resources) {
    delta[resource.key] = perSecond[resource.key] * seconds;
  }
  addResources(delta);
}

function resolveRaid() {
  const enemyStrength = randomInt(8 + state.age * 4, 18 + state.age * 8 + state.world.raid.wavesSurvived * 2);
  const defenseStrength = state.army.warriors * 4 + getVillageSupportStrength();
  const lostWarriors = Math.min(state.army.warriors, Math.max(0, Math.floor((enemyStrength - defenseStrength / 2) / 10)));
  let outcome = "victory";
  let loot = null;
  let damage = null;

  if (defenseStrength >= enemyStrength) {
    state.army.warriors = Math.max(0, state.army.warriors - lostWarriors);
    loot = { influence: randomInt(20, 55), wood: randomInt(12, 28) };
    addResources(loot);
    addLog(`A raid was defeated. Your defenders held with strength ${defenseStrength} against ${enemyStrength}.`);
  } else {
    outcome = "loss";
    state.army.warriors = Math.max(0, state.army.warriors - Math.max(1, lostWarriors + 1));
    damage = {
      influence: Math.min(state.resources.influence, randomInt(18, 50)),
      wood: Math.min(state.resources.wood, randomInt(10, 28)),
      stone: Math.min(state.resources.stone, randomInt(0, 18)),
    };
    for (const [key, value] of Object.entries(damage)) {
      state.resources[key] -= value;
    }
    addLog(`A raid broke through. Defense ${defenseStrength} was not enough for enemy strength ${enemyStrength}.`);
  }

  state.world.raid.wavesSurvived += 1;
  state.world.raid.lastRaid = {
    time: Date.now(),
    outcome,
    enemyStrength,
    defenseStrength,
    lostWarriors,
    loot,
    damage,
  };
  scheduleNextRaid();
}

function processWorldEvents() {
  if (!state.world.villageScoutsUnlocked && state.world.elapsedSeconds >= state.world.villageScoutUnlockAt) {
    state.world.villageScoutsUnlocked = true;
    addLog("Word spreads of skilled village scouts willing to search the frontier.");
  }

  if (state.world.raid.enabled && state.world.raid.nextRaidAt !== null) {
    let safety = 0;
    while (state.world.elapsedSeconds >= state.world.raid.nextRaidAt && safety < 8) {
      resolveRaid();
      safety += 1;
    }
  }

  for (const explorer of state.explorers.roster) {
    if (explorer.mission && !explorer.mission.reported && Date.now() >= explorer.mission.endsAt) {
      explorer.mission.reported = true;
      addLog(`${explorer.name} is back from ${explorer.mission.name} and ready to claim rewards.`);
    }
  }
}
function applyOfflineProgress() {
  const now = Date.now();
  const elapsedSeconds = Math.max(0, Math.min((now - state.lastTick) / 1000, 60 * 60 * 6));
  if (elapsedSeconds >= 1) {
    state.world.elapsedSeconds += elapsedSeconds;
    applyProduction(elapsedSeconds);
    processWorldEvents();
    addLog(`Your settlement progressed for ${Math.floor(elapsedSeconds)} seconds while you were away.`);
  }
  state.lastTick = now;
}

function renderResourceRibbon() {
  const perSecond = getProductionPerSecond();
  UI.resourceRibbon.innerHTML = resources
    .map(
      (resource) => `
        <article class="resource-card">
          <span class="resource-label">${resource.label}</span>
          <strong>${formatNumber(state.resources[resource.key])}</strong>
          <div class="resource-rate">+${formatNumber(perSecond[resource.key])} / sec</div>
        </article>
      `
    )
    .join("");
}

function renderSummary() {
  const unlockedClickers = clickerDefs.filter((clicker) => isClickerUnlocked(clicker.key));
  const production = getProductionPerSecond();
  const totalProduction = Object.values(production).reduce((sum, value) => sum + value, 0);
  const productionParts = jobs
    .filter((job) => (state.workers.assignments[job.key] || 0) > 0)
    .map((job) => `${job.name}: ${formatNumber(production[job.key])}/sec`)
    .slice(0, 3);
  const mainExplorer = state.explorers.roster[0];

  UI.playerName.textContent = "Player";
  UI.ageName.textContent = ages[state.age].name;
  UI.villagerSummary.textContent = `${state.workers.total} / ${getWorkerCapacity()}`;
  UI.explorerLevelSummary.textContent = `${getExplorerLevel(mainExplorer)}`;
  UI.clickingSummary.textContent = `${unlockedClickers.length} action${unlockedClickers.length === 1 ? "" : "s"} unlocked`;
  UI.clickingDetail.textContent = `Click hands ${state.clicker.burstLevel}/${MAX_CLICK_BURST} and click power ${state.clicker.powerLevel}/${MAX_CLICK_POWER}.`;
  UI.productionSummary.textContent = `${formatNumber(totalProduction)} / sec`;
  UI.productionDetail.textContent = productionParts.join(" | ") || "No villagers are assigned yet.";
  UI.settlementSummary.textContent = `${getTotalBuildings()} building${getTotalBuildings() === 1 ? "" : "s"}`;
  UI.settlementDetail.textContent = `Open plots: ${getOpenPlots()} | Villages found: ${state.world.villages.length} | Warriors: ${state.army.warriors}`;
}

function renderTabs() {
  UI.tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === state.activeTab);
  });
  UI.tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === state.activeTab);
  });
}

function getClickerPreviewMarkup(label) {
  return `
    <div class="clicker-preview theme-${state.clicker.theme}">
      <div class="clicker-core">${label}</div>
    </div>
  `;
}

function renderClickers() {
  UI.clickerList.innerHTML = clickerDefs
    .map((clicker) => {
      const unlocked = isClickerUnlocked(clicker.key);
      const yieldAmount = getClickYield(clicker.key);
      return `
        <article class="game-card clicker-button ${unlocked ? "" : "locked"}">
          <div class="card-top">
            <div>
              <h3>${clicker.name}</h3>
              <p class="soft-text">${clicker.description}</p>
            </div>
            <span class="meta-pill">${unlocked ? "Unlocked" : "Locked"}</span>
          </div>
          ${getClickerPreviewMarkup(capitalize(clicker.key).slice(0, 2))}
          <div class="job-row">
            <span class="status-pill">${unlocked ? `+${formatNumber(yieldAmount)} ${capitalize(clicker.key)} per press` : clicker.unlockText}</span>
          </div>
          <button class="action-button" type="button" data-click="${clicker.key}" ${unlocked ? "" : "disabled"}>
            ${unlocked ? clicker.name : "Locked"}
          </button>
        </article>
      `;
    })
    .join("");

  Array.from(document.querySelectorAll("[data-click]")).forEach((button) => {
    button.addEventListener("click", () => performClick(button.dataset.click));
  });
}

function renderClickerWorkshop() {
  const burstCost = getClickBurstUpgradeCost();
  const powerCost = getClickPowerUpgradeCost();

  UI.clickerWorkshop.innerHTML = `
    <article class="workshop-card">
      <div class="card-top">
        <div>
          <h3>Click Count</h3>
          <p class="soft-text">Increase how many hand bursts each click produces.</p>
        </div>
        <span class="meta-pill">${state.clicker.burstLevel} / ${MAX_CLICK_BURST}</span>
      </div>
      <div class="cost-row">${formatCostPills(burstCost)}</div>
      <button id="upgradeBurstButton" class="action-button" type="button" ${state.clicker.burstLevel >= MAX_CLICK_BURST || !canAfford(burstCost) ? "disabled" : ""}>
        ${state.clicker.burstLevel >= MAX_CLICK_BURST ? "Burst Cap Reached" : "Add Another Click Hand"}
      </button>
    </article>

    <article class="workshop-card">
      <div class="card-top">
        <div>
          <h3>Click Strength</h3>
          <p class="soft-text">Increase the payout of every manual click action.</p>
        </div>
        <span class="meta-pill">${state.clicker.powerLevel} / ${MAX_CLICK_POWER}</span>
      </div>
      <div class="cost-row">${formatCostPills(powerCost)}</div>
      <button id="upgradePowerButton" class="action-button alt" type="button" ${state.clicker.powerLevel >= MAX_CLICK_POWER || !canAfford(powerCost) ? "disabled" : ""}>
        ${state.clicker.powerLevel >= MAX_CLICK_POWER ? "Power Cap Reached" : "Increase Click Strength"}
      </button>
    </article>

    <article class="workshop-card">
      <div class="card-top">
        <div>
          <h3>Clicker Style</h3>
          <p class="soft-text">Pick how the clicker buttons look across the whole game.</p>
        </div>
      </div>
      <div class="style-grid">
        ${clickerThemes
          .map(
            (theme) => `
              <button class="style-chip ${state.clicker.theme === theme.id ? "active" : ""}" type="button" data-theme="${theme.id}">
                <span class="style-swatch ${theme.swatch}"></span>
                ${theme.label}
              </button>
            `
          )
          .join("")}
      </div>
    </article>
  `;

  const burstButton = document.getElementById("upgradeBurstButton");
  if (burstButton) burstButton.addEventListener("click", buyClickUpgradeBurst);

  const powerButton = document.getElementById("upgradePowerButton");
  if (powerButton) powerButton.addEventListener("click", buyClickUpgradePower);

  Array.from(document.querySelectorAll("[data-theme]")).forEach((button) => {
    button.addEventListener("click", () => {
      state.clicker.theme = button.dataset.theme;
      markDirty();
      renderAll();
    });
  });
}

function renderMilestone() {
  const nextLocked = clickerDefs.find((clicker) => !isClickerUnlocked(clicker.key));
  const nextAge = getNextAge();
  const progressPercent = Math.round(getAgeProgress() * 100);

  if (!nextAge) {
    UI.milestoneCard.innerHTML = `
      <div class="age-row">
        <div>
          <h3>Realm Complete</h3>
          <p class="soft-text">All ages in this build are unlocked.</p>
        </div>
        <span class="meta-pill">Complete</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width: 100%"></div></div>
      <p class="soft-text">Keep expanding the map, leveling explorers, and fortifying your defenses.</p>
    `;
    return;
  }

  UI.milestoneCard.innerHTML = `
    <div class="age-row">
      <div>
        <h3>${nextAge.name}</h3>
        <p class="soft-text">${nextAge.description}</p>
      </div>
      <span class="meta-pill">${progressPercent}% ready</span>
    </div>
    <div class="progress-track"><div class="progress-fill" style="width: ${progressPercent}%"></div></div>
    <p class="soft-text"><strong>Age unlock:</strong> ${nextAge.unlocks}</p>
    <p class="soft-text"><strong>Next clicker:</strong> ${nextLocked ? nextLocked.unlockText : "All clickers unlocked."}</p>
    <div class="cost-row">
      ${formatCostPills(nextAge.cost)}
      <span class="cost-pill ${getTotalBuildings() >= nextAge.minBuildings ? "" : "missing"}">${getTotalBuildings()} / ${nextAge.minBuildings} buildings</span>
    </div>
  `;
}

function renderLog() {
  UI.logList.innerHTML = state.log
    .map(
      (entry) => `
        <article class="log-card">
          <span>${new Date(entry.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          <p>${escapeHtml(entry.text)}</p>
        </article>
      `
    )
    .join("");
}

function renderPopulation() {
  const capacity = getWorkerCapacity();
  const hireCost = getHireCost();

  UI.populationCard.innerHTML = `
    <div class="population-row">
      <span class="meta-pill">Villagers: ${state.workers.total} / ${capacity}</span>
      <span class="meta-pill">Assigned: ${getAssignedWorkers()}</span>
      <span class="meta-pill">Idle: ${getIdleWorkers()}</span>
    </div>
    <p class="soft-text">Housing increases worker capacity while production buildings create job slots.</p>
    <div class="cost-row">${formatCostPills(hireCost)}</div>
    <button id="hireWorkerButton" class="action-button" type="button" ${state.workers.total >= capacity || !canAfford(hireCost) ? "disabled" : ""}>
      ${state.workers.total >= capacity ? "Housing Full" : "Hire 1 Villager"}
    </button>
  `;

  const hireButton = document.getElementById("hireWorkerButton");
  if (hireButton) hireButton.addEventListener("click", hireVillager);
}

function getSlotSourceText(jobKey) {
  const counts = getBuildingCounts();
  const sources = [];
  for (const building of buildingDefs) {
    if ((building.jobSlots[jobKey] || 0) > 0 && counts[building.id] > 0) {
      sources.push(`${building.name} x${counts[building.id]}`);
    }
  }
  return sources.join(" | ");
}

function renderWorkers() {
  const caps = getJobCaps();
  const production = getProductionPerSecond();

  UI.workerList.innerHTML = jobs
    .map((job) => {
      const cap = caps[job.key];
      const assigned = state.workers.assignments[job.key] || 0;
      const unlocked = cap > 0;
      const canAdd = unlocked && getIdleWorkers() > 0 && assigned < cap;
      const canRemove = assigned > 0;

      return `
        <article class="game-card ${unlocked ? "" : "locked"}">
          <div class="card-top">
            <div>
              <h3>${job.name}</h3>
              <p class="soft-text">${job.description}</p>
            </div>
            <span class="meta-pill">${assigned} / ${cap} assigned</span>
          </div>
          <div class="job-row">
            <span class="status-pill">${formatNumber(job.rate)} ${capitalize(job.key)} per worker</span>
            <span class="status-pill">${formatNumber(production[job.key])} total / sec</span>
          </div>
          <div class="job-row">
            <button class="tiny-button remove" type="button" data-assign="${job.key}" data-change="-1" ${canRemove ? "" : "disabled"}>-</button>
            <button class="tiny-button" type="button" data-assign="${job.key}" data-change="1" ${canAdd ? "" : "disabled"}>+</button>
          </div>
          <p class="soft-text">${unlocked ? `Slot source: ${getSlotSourceText(job.key)}` : `Build the right structure to unlock ${job.name.toLowerCase()} slots.`}</p>
        </article>
      `;
    })
    .join("");

  Array.from(document.querySelectorAll("[data-assign]")).forEach((button) => {
    button.addEventListener("click", () => adjustAssignment(button.dataset.assign, Number(button.dataset.change)));
  });
}

function renderCombat() {
  const warriorCost = getWarriorCost();
  const raid = state.world.raid;
  const nextRaidText = raid.enabled && raid.nextRaidAt !== null
    ? formatDuration(Math.max(0, raid.nextRaidAt - state.world.elapsedSeconds))
    : "Inactive";
  const support = getVillageSupportStrength();
  const lastRaid = raid.lastRaid;
  const warriorsUnlocked = getBuildingCounts().hall > 0 || state.age >= 1;

  UI.combatCard.innerHTML = `
    <div class="population-row">
      <span class="meta-pill">Warriors: ${state.army.warriors}</span>
      <span class="meta-pill">Defense Strength: ${state.army.warriors * 4 + support}</span>
      <span class="meta-pill">Village Support: ${support}</span>
    </div>
    <p class="soft-text">Raids start only after you recruit your first warrior. Then a new wave spawns every 10 to 20 minutes at random.</p>
    <div class="cost-row">${formatCostPills(warriorCost)}</div>
    <button id="hireWarriorButton" class="action-button" type="button" ${!warriorsUnlocked || !canAfford(warriorCost) ? "disabled" : ""}>
      ${warriorsUnlocked ? "Hire 1 Warrior" : "Build a Hall or reach Village age"}
    </button>
    <div class="job-row">
      <span class="status-pill">Next wave: ${nextRaidText}</span>
      <span class="status-pill">Waves survived: ${raid.wavesSurvived}</span>
    </div>
    ${
      lastRaid
        ? `<div class="empty-note">Last raid: ${lastRaid.outcome === "victory" ? "Victory" : "Loss"} | Enemy ${lastRaid.enemyStrength} | Defense ${lastRaid.defenseStrength}</div>`
        : `<div class="empty-note">No raid has hit your settlement yet.</div>`
    }
  `;

  const warriorButton = document.getElementById("hireWarriorButton");
  if (warriorButton) warriorButton.addEventListener("click", hireWarrior);
}

function getBuildingVisualMarkup(buildingId) {
  return `
    <div class="tile-structure building-${buildingId}">
      <span class="building-roof"></span>
      <span class="building-body"></span>
      <span class="building-detail"></span>
      <span class="building-extra"></span>
    </div>
  `;
}

function formatSlotSummary(slotMap) {
  const items = jobs
    .filter((job) => slotMap[job.key])
    .map((job) => `${job.name} +${slotMap[job.key]}`);
  return items.length ? items.join(" | ") : "No job slots";
}

function renderBuildings() {
  const counts = getBuildingCounts();

  UI.buildingList.innerHTML = buildingDefs
    .filter((building) => !building.fixed)
    .map((building) => {
      const unlocked = state.age >= building.minAge;
      const affordable = unlocked && canAfford(building.cost);
      const openPlots = getOpenPlots();
      const selected = state.pendingBuild === building.id;

      return `
        <article class="game-card ${unlocked ? "" : "locked"}">
          <div class="card-top">
            <div>
              <h3>${building.name}</h3>
              <p class="soft-text">${building.description}</p>
            </div>
            <span class="meta-pill">${counts[building.id]} built</span>
          </div>
          <div class="clicker-preview">${getBuildingVisualMarkup(building.id)}</div>
          <div class="job-row">
            <span class="status-pill">Housing +${building.workerCap}</span>
            <span class="status-pill">${formatSlotSummary(building.jobSlots)}</span>
          </div>
          <div class="cost-row">${formatCostPills(building.cost)}</div>
          <button class="action-button alt" type="button" data-build="${building.id}" ${unlocked && affordable && openPlots > 0 ? "" : "disabled"}>
            ${
              openPlots === 0
                ? "No Open Plots"
                : unlocked
                  ? selected
                    ? "Selected For Placement"
                    : "Choose And Place"
                  : `Unlocks in ${ages[building.minAge].name}`
            }
          </button>
        </article>
      `;
    })
    .join("");

  Array.from(document.querySelectorAll("[data-build]")).forEach((button) => {
    button.addEventListener("click", () => requestBuild(button.dataset.build));
  });
}

function renderAgeProgress() {
  const currentAge = ages[state.age];
  const nextAge = getNextAge();

  if (!nextAge) {
    UI.ageProgressCard.innerHTML = `
      <div class="age-row">
        <div>
          <h3>${currentAge.name}</h3>
          <p class="soft-text">${currentAge.description}</p>
        </div>
        <span class="meta-pill">Final Age</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width: 100%"></div></div>
      <p class="soft-text">${currentAge.unlocks}</p>
      <button class="action-button" type="button" disabled>Maximum Age Reached</button>
    `;
    return;
  }

  const progressPercent = Math.round(getAgeProgress() * 100);
  UI.ageProgressCard.innerHTML = `
    <div class="age-row">
      <div>
        <p class="label">Current</p>
        <h3>${currentAge.name}</h3>
        <p class="soft-text">${currentAge.description}</p>
      </div>
      <div>
        <p class="label">Next</p>
        <h3>${nextAge.name}</h3>
        <p class="soft-text">${nextAge.unlocks}</p>
      </div>
    </div>
    <div class="progress-track"><div class="progress-fill" style="width: ${progressPercent}%"></div></div>
    <div class="cost-row">
      ${formatCostPills(nextAge.cost)}
      <span class="cost-pill ${getTotalBuildings() >= nextAge.minBuildings ? "" : "missing"}">${getTotalBuildings()} / ${nextAge.minBuildings} buildings</span>
    </div>
    <button id="advanceAgeButton" class="action-button" type="button" ${canAdvanceAge() ? "" : "disabled"}>
      ${canAdvanceAge() ? `Advance to ${nextAge.name}` : "Requirements not met"}
    </button>
  `;

  const advanceButton = document.getElementById("advanceAgeButton");
  if (advanceButton) advanceButton.addEventListener("click", advanceAge);
}

function renderMapExpansion() {
  const cost = getMapExpansionCost();
  const maxed = state.grid.length >= MAX_PLOTS;
  const pendingBuilding = state.pendingBuild ? getBuildingDefinition(state.pendingBuild) : null;

  UI.mapExpansionCard.innerHTML = `
    <div class="card-top">
      <div>
        <h3>Expand The Map</h3>
        <p class="soft-text">Pay to add ${EXPANSION_SIZE} more plots and grow the settlement board.</p>
      </div>
      <span class="meta-pill">${state.grid.length} plots</span>
    </div>
    <div class="cost-row">${formatCostPills(cost)}</div>
    <button id="expandMapButton" class="action-button alt" type="button" ${maxed || !canAfford(cost) ? "disabled" : ""}>
      ${maxed ? "Map Fully Expanded" : "Expand Map"}
    </button>
    ${
      pendingBuilding
        ? `<div class="empty-note">Placing: ${pendingBuilding.name}. Tap any open green tile below to place it, or cancel.</div>
           <button id="cancelPlacementButton" class="picker-button" type="button">Cancel Placement</button>`
        : `<div class="empty-note">No building is selected for placement right now.</div>`
    }
  `;

  const expandButton = document.getElementById("expandMapButton");
  if (expandButton) expandButton.addEventListener("click", expandMap);

  const cancelPlacement = document.getElementById("cancelPlacementButton");
  if (cancelPlacement) {
    cancelPlacement.addEventListener("click", () => {
      state.pendingBuild = null;
      markDirty();
      renderAll();
    });
  }
}

function renderSettlementGrid() {
  const rows = Math.ceil(state.grid.length / GRID_COLUMNS);
  UI.settlementGrid.style.minHeight = `${rows * 118 + 180}px`;

  UI.settlementGrid.innerHTML = state.grid
    .map((id, index) => {
      const row = Math.floor(index / GRID_COLUMNS);
      const col = index % GRID_COLUMNS;
      const tileClasses = ["settlement-tile"];

      if (!id) {
        tileClasses.push("empty");
        if (state.pendingBuild) tileClasses.push("selectable");
        return `
          <article class="${tileClasses.join(" ")}" style="--row:${row}; --col:${col};" data-place-index="${index}">
            <div class="tile-surface">
              <div class="tile-inner">
                <span class="tile-label">Plot ${index + 1}</span>
                <strong>${state.pendingBuild ? "Place Here" : "Open Plot"}</strong>
                <span class="tile-note">${state.pendingBuild ? "Tap to place the selected building" : "Ready for construction"}</span>
              </div>
            </div>
          </article>
        `;
      }

      const building = getBuildingDefinition(id);
      tileClasses.push(`type-${building.id}`);
      if (state.pendingBuild && !id) tileClasses.push("pending");

      return `
        <article class="${tileClasses.join(" ")}" style="--row:${row}; --col:${col};">
          <div class="tile-surface">
            <div class="tile-inner">
              <span class="tile-label">${building.tileTag}</span>
              ${getBuildingVisualMarkup(building.id)}
              <strong>${building.name}</strong>
              <span class="tile-note">Housing +${building.workerCap} | ${formatSlotSummary(building.jobSlots)}</span>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  Array.from(document.querySelectorAll("[data-place-index]")).forEach((tile) => {
    tile.addEventListener("click", () => placePendingBuild(Number(tile.dataset.placeIndex)));
  });
}

function renderExplorer() {
  const selected = getSelectedExplorer();
  const progress = getExplorerProgress(selected);
  const recruitCost = getRecruitExplorerCost();
  const scoutCost = getRecruitVillageScoutCost();

  UI.explorerCard.innerHTML = `
    <div class="roster-list">
      ${state.explorers.roster
        .map(
          (explorer) => `
            <article class="roster-card ${explorer.id === selected.id ? "active" : ""}" data-select-explorer="${explorer.id}">
              <div class="card-top">
                <div>
                  <h3>${escapeHtml(explorer.name)}</h3>
                  <p class="soft-text">${explorer.type === "village_scout" ? "Village Scout" : archetypes[explorer.archetype].label}</p>
                </div>
                <span class="meta-pill">Lv ${getExplorerLevel(explorer)}</span>
              </div>
              <div class="job-row">
                <span class="status-pill">${explorer.mission ? "Busy" : "Ready"}</span>
                <span class="status-pill">${explorer.type === "village_scout" ? "Scout" : `Power ${getExplorerPower(explorer)}`}</span>
              </div>
            </article>
          `
        )
        .join("")}
    </div>

    <div class="explorer-preview cloak-${selected.cloak} accent-${selected.accent}">
      <div class="hero-avatar">
        <span class="hero-cloak"></span>
        <span class="hero-body"></span>
        <span class="hero-head"></span>
        <span class="hero-hair"></span>
        <span class="hero-weapon"></span>
      </div>
    </div>

    <div class="field-row">
      <div class="field-block">
        <label class="field-label" for="explorerNameInput">Name</label>
        <input id="explorerNameInput" value="${escapeHtml(selected.name)}" />
      </div>
      <div class="field-block">
        <label class="field-label" for="explorerArchetypeSelect">Role</label>
        <select id="explorerArchetypeSelect" ${selected.type === "village_scout" ? "disabled" : ""}>
          ${Object.entries(archetypes)
            .map(
              ([key, value]) => `
                <option value="${key}" ${selected.archetype === key ? "selected" : ""}>${value.label}</option>
              `
            )
            .join("")}
        </select>
      </div>
    </div>

    <div class="field-row">
      <div class="field-block">
        <label class="field-label" for="explorerCloakSelect">Cloak</label>
        <select id="explorerCloakSelect">
          ${["ember", "moss", "sky", "plum"]
            .map((value) => `<option value="${value}" ${selected.cloak === value ? "selected" : ""}>${capitalize(value)}</option>`)
            .join("")}
        </select>
      </div>
      <div class="field-block">
        <label class="field-label" for="explorerAccentSelect">Outfit</label>
        <select id="explorerAccentSelect">
          ${["bronze", "steel", "forest"]
            .map((value) => `<option value="${value}" ${selected.accent === value ? "selected" : ""}>${capitalize(value)}</option>`)
            .join("")}
        </select>
      </div>
    </div>

    <div class="hero-summary-row">
      <span class="meta-pill">Level ${progress.level}</span>
      <span class="meta-pill">${selected.type === "village_scout" ? "Village Scout" : `Power ${getExplorerPower(selected)}`}</span>
      <span class="meta-pill">${isInstantExplorer(selected) ? "Secret active" : "Normal timing"}</span>
    </div>

    <div class="progress-track"><div class="progress-fill" style="width: ${Math.round(progress.percent * 100)}%"></div></div>
    <p class="soft-text">${formatNumber(progress.intoLevel)} / ${formatNumber(progress.needed)} XP to next level.</p>

    <div class="cost-row">
      <button id="recruitExplorerButton" class="action-button" type="button" ${!canAfford(recruitCost) ? "disabled" : ""}>Recruit Adventurer</button>
      <span class="soft-text">${formatCostPills(recruitCost)}</span>
    </div>
    ${
      state.world.villageScoutsUnlocked
        ? `<div class="cost-row">
             <button id="recruitVillageScoutButton" class="action-button alt" type="button" ${!canAfford(scoutCost) ? "disabled" : ""}>Hire Village Scout</button>
             <span class="soft-text">${formatCostPills(scoutCost)}</span>
           </div>`
        : `<div class="empty-note">Village scouts may appear at a random time after five minutes of in-game progress.</div>`
    }
  `;

  Array.from(document.querySelectorAll("[data-select-explorer]")).forEach((card) => {
    card.addEventListener("click", () => {
      state.explorers.selectedId = card.dataset.selectExplorer;
      markDirty();
      renderAll();
    });
  });

  document.getElementById("explorerNameInput").addEventListener("input", (event) => {
    selected.name = event.target.value.slice(0, 18) || "ari";
    markDirty();
    renderExplorer();
    renderExpeditions();
    renderFrontier();
  });

  const archetypeSelect = document.getElementById("explorerArchetypeSelect");
  if (archetypeSelect) {
    archetypeSelect.addEventListener("change", (event) => {
      selected.archetype = event.target.value;
      markDirty();
      renderAll();
    });
  }

  document.getElementById("explorerCloakSelect").addEventListener("change", (event) => {
    selected.cloak = event.target.value;
    markDirty();
    renderExplorer();
  });

  document.getElementById("explorerAccentSelect").addEventListener("change", (event) => {
    selected.accent = event.target.value;
    markDirty();
    renderExplorer();
  });

  const recruitExplorerButton = document.getElementById("recruitExplorerButton");
  if (recruitExplorerButton) recruitExplorerButton.addEventListener("click", recruitExplorer);

  const recruitVillageScoutButton = document.getElementById("recruitVillageScoutButton");
  if (recruitVillageScoutButton) recruitVillageScoutButton.addEventListener("click", recruitVillageScout);
}

function renderCrafting() {
  const selected = getSelectedExplorer();

  if (selected.type === "village_scout") {
    UI.craftingList.innerHTML = `<div class="empty-note">Village scouts do not use crafted combat gear. Select an adventurer to craft weapons and armor.</div>`;
    return;
  }

  UI.craftingList.innerHTML = gearRecipes
    .map((recipe) => {
      const crafted = selected.crafted[recipe.id];
      const equipped =
        (recipe.slot === "weapon" && selected.equippedWeapon === recipe.id) ||
        (recipe.slot === "armor" && selected.equippedArmor === recipe.id);
      const unlocked = state.age >= recipe.minAge;
      const affordable = unlocked && canAfford(recipe.cost);

      return `
        <article class="game-card ${unlocked ? "" : "locked"}">
          <div class="card-top">
            <div>
              <h3>${recipe.name}</h3>
              <p class="soft-text">${recipe.description}</p>
            </div>
            <span class="meta-pill">${recipe.slot} +${recipe.power}</span>
          </div>
          <div class="job-row">
            <span class="status-pill">${crafted ? "Crafted" : "Not crafted"}</span>
            <span class="status-pill">${equipped ? "Equipped" : "Not equipped"}</span>
          </div>
          <div class="cost-row">${formatCostPills(recipe.cost)}</div>
          <div class="job-row">
            <button class="action-button" type="button" data-craft="${recipe.id}" ${crafted || !affordable ? "disabled" : ""}>
              ${crafted ? "Crafted" : unlocked ? "Craft" : `Unlocks in ${ages[recipe.minAge].name}`}
            </button>
            <button class="picker-button" type="button" data-equip="${recipe.id}" ${crafted && !equipped ? "" : "disabled"}>
              Equip
            </button>
          </div>
        </article>
      `;
    })
    .join("");

  Array.from(document.querySelectorAll("[data-craft]")).forEach((button) => {
    button.addEventListener("click", () => craftItem(button.dataset.craft));
  });
  Array.from(document.querySelectorAll("[data-equip]")).forEach((button) => {
    button.addEventListener("click", () => equipItem(button.dataset.equip));
  });
}

function getExpeditionLockText(expedition, explorer) {
  if (getExplorerLevel(explorer) < expedition.minLevel) return `Need level ${expedition.minLevel}`;
  if (expedition.requiredWeapon && !explorer.crafted[expedition.requiredWeapon]) return `Craft ${getRecipe(expedition.requiredWeapon).name}`;
  if (expedition.requiredArmor && !explorer.crafted[expedition.requiredArmor]) return `Craft ${getRecipe(expedition.requiredArmor).name}`;
  return "Locked";
}

function getAdjustedDuration(explorer, duration) {
  if (isInstantExplorer(explorer)) return 0;
  const multiplier = explorer.type === "village_scout" ? 1 : archetypes[explorer.archetype].durationMultiplier;
  return Math.max(explorer.type === "village_scout" ? 3600 : duration, Math.round(duration * multiplier));
}

function renderExpeditions() {
  const selected = getSelectedExplorer();

  if (selected.mission) {
    UI.expeditionList.innerHTML = `<div class="empty-note">${escapeHtml(selected.name)} is already out on a mission.</div>`;
    return;
  }

  if (selected.type === "village_scout") {
    const scoutCost = { influence: 90, wood: 45, stone: 20 };
    const duration = getAdjustedDuration(selected, 3600);
    UI.expeditionList.innerHTML = `
      <article class="game-card">
        <div class="card-top">
          <div>
            <h3>Search For Villages</h3>
            <p class="soft-text">Village scouts spend at least an hour searching the frontier for settlements to trade with.</p>
          </div>
          <span class="meta-pill">${duration === 0 ? "Instant" : formatDuration(duration)}</span>
        </div>
        <div class="job-row">
          <span class="status-pill">Finds 1 village</span>
          <span class="status-pill">Support unlock</span>
        </div>
        <div class="cost-row">${formatCostPills(scoutCost)}</div>
        <button id="startVillageScoutButton" class="action-button" type="button" ${canAfford(scoutCost) ? "" : "disabled"}>
          Send Village Scout
        </button>
      </article>
    `;

    const scoutButton = document.getElementById("startVillageScoutButton");
    if (scoutButton) scoutButton.addEventListener("click", () => startVillageScoutMission(selected.id, scoutCost));
    return;
  }

  UI.expeditionList.innerHTML = expeditions
    .map((expedition) => {
      const unlocked = isExpeditionUnlocked(expedition, selected);
      const affordable = unlocked && canAfford(expedition.cost);
      const rewardBits = resources
        .filter((resource) => expedition.rewards[resource.key])
        .map((resource) => `${capitalize(resource.key)} ${expedition.rewards[resource.key][0]}-${expedition.rewards[resource.key][1]}`);
      const duration = getAdjustedDuration(selected, expedition.duration);

      return `
        <article class="game-card ${unlocked ? "" : "locked"}">
          <div class="card-top">
            <div>
              <h3>${expedition.name}</h3>
              <p class="soft-text">${expedition.description}</p>
            </div>
            <span class="meta-pill">${duration === 0 ? "Instant" : formatDuration(duration)}</span>
          </div>
          <div class="job-row">
            <span class="status-pill">Level ${expedition.minLevel}+</span>
            <span class="status-pill">XP ${expedition.xp}</span>
          </div>
          <p class="soft-text">Rewards: ${rewardBits.join(" | ")}</p>
          <div class="cost-row">${formatCostPills(expedition.cost)}</div>
          <button class="action-button" type="button" data-expedition="${expedition.id}" ${unlocked && affordable ? "" : "disabled"}>
            ${unlocked ? `Send ${escapeHtml(selected.name)}` : getExpeditionLockText(expedition, selected)}
          </button>
        </article>
      `;
    })
    .join("");

  Array.from(document.querySelectorAll("[data-expedition]")).forEach((button) => {
    button.addEventListener("click", () => startExpedition(button.dataset.expedition));
  });
}

function renderFrontier() {
  const activeExplorers = state.explorers.roster.filter((explorer) => explorer.mission);
  const villagesMarkup = state.world.villages.length
    ? state.world.villages
        .map((village) => {
          const tradeCost = getVillageTradeCost(village);
          const cooldownSeconds = Math.max(0, Math.ceil((village.tradeCooldownUntil - Date.now()) / 1000));
          return `
            <article class="game-card">
              <div class="card-top">
                <div>
                  <h3>${village.name}</h3>
                  <p class="soft-text">Trades completed: ${village.trades}</p>
                </div>
                <span class="meta-pill">Support ${village.support}</span>
              </div>
              <div class="cost-row">${formatCostPills(tradeCost)}</div>
              <button class="picker-button" type="button" data-trade-village="${village.id}" ${cooldownSeconds > 0 || !canAfford(tradeCost) ? "disabled" : ""}>
                ${cooldownSeconds > 0 ? `Trade ready in ${formatDuration(cooldownSeconds)}` : "Trade For Aid"}
              </button>
            </article>
          `;
        })
        .join("")
    : `<div class="empty-note">No villages have been found yet. Village scouts can discover them after they unlock.</div>`;

  const missionsMarkup = activeExplorers.length
    ? activeExplorers
        .map((explorer) => {
          const remaining = Math.max(0, Math.ceil((explorer.mission.endsAt - Date.now()) / 1000));
          return `
            <article class="game-card">
              <div class="card-top">
                <div>
                  <h3>${escapeHtml(explorer.name)}</h3>
                  <p class="soft-text">${explorer.mission.name}</p>
                </div>
                <span class="meta-pill">${explorer.mission.reported ? "Ready" : "Running"}</span>
              </div>
              <div class="job-row">
                <span class="status-pill">${explorer.mission.reported ? "Claim rewards now" : formatDuration(remaining)}</span>
                <button class="action-button" type="button" data-claim-mission="${explorer.id}" ${explorer.mission.reported ? "" : "disabled"}>
                  ${explorer.mission.reported ? "Claim" : "Exploring"}
                </button>
              </div>
            </article>
          `;
        })
        .join("")
    : `<div class="empty-note">No explorer is currently away from camp.</div>`;

  UI.frontierCard.innerHTML = `
    <div class="card-top">
      <div>
        <h3>Active Missions</h3>
        <p class="soft-text">Explorers can run missions at the same time as long as each one is free.</p>
      </div>
    </div>
    ${missionsMarkup}
    <div class="card-top">
      <div>
        <h3>Discovered Villages</h3>
        <p class="soft-text">Trade with villages to gain resources and support for future raids.</p>
      </div>
    </div>
    ${villagesMarkup}
  `;

  Array.from(document.querySelectorAll("[data-claim-mission]")).forEach((button) => {
    button.addEventListener("click", () => claimMission(button.dataset.claimMission));
  });

  Array.from(document.querySelectorAll("[data-trade-village]")).forEach((button) => {
    button.addEventListener("click", () => tradeWithVillage(button.dataset.tradeVillage));
  });
}

function getVillageTradeCost(village) {
  return {
    influence: 75 + village.trades * 18,
    wood: 25 + village.trades * 12,
  };
}

function renderAll() {
  if (!state) return;
  renderTabs();
  renderResourceRibbon();
  renderSummary();
  renderClickers();
  renderClickerWorkshop();
  renderMilestone();
  renderLog();
  renderPopulation();
  renderWorkers();
  renderCombat();
  renderBuildings();
  renderAgeProgress();
  renderMapExpansion();
  renderSettlementGrid();
  renderExplorer();
  renderCrafting();
  renderExpeditions();
  renderFrontier();
  lastFullRender = Date.now();
}

function performClick(resourceKey) {
  if (!isClickerUnlocked(resourceKey)) return;
  state.resources[resourceKey] += getClickYield(resourceKey);
  state.totalClicks += state.clicker.burstLevel;
  markDirty();
  renderAll();
}

function buyClickUpgradeBurst() {
  if (state.clicker.burstLevel >= MAX_CLICK_BURST) return;
  const cost = getClickBurstUpgradeCost();
  if (!canAfford(cost)) return;
  spendResources(cost);
  state.clicker.burstLevel += 1;
  addLog(`Click hands increased to ${state.clicker.burstLevel}.`);
  markDirty();
  renderAll();
}

function buyClickUpgradePower() {
  if (state.clicker.powerLevel >= MAX_CLICK_POWER) return;
  const cost = getClickPowerUpgradeCost();
  if (!canAfford(cost)) return;
  spendResources(cost);
  state.clicker.powerLevel += 1;
  addLog(`Click strength increased to x${formatNumber(getClickPowerMultiplier())}.`);
  markDirty();
  renderAll();
}

function hireVillager() {
  const cost = getHireCost();
  if (state.workers.total >= getWorkerCapacity() || !canAfford(cost)) return;
  spendResources(cost);
  state.workers.total += 1;
  addLog("A new villager joins the settlement.");
  markDirty();
  renderAll();
}

function adjustAssignment(jobKey, change) {
  const caps = getJobCaps();
  const current = state.workers.assignments[jobKey] || 0;
  const next = current + change;

  if (change > 0) {
    if (getIdleWorkers() <= 0 || next > caps[jobKey]) return;
  } else if (next < 0) {
    return;
  }

  state.workers.assignments[jobKey] = next;
  markDirty();
  renderAll();
}

function hireWarrior() {
  const warriorsUnlocked = getBuildingCounts().hall > 0 || state.age >= 1;
  const cost = getWarriorCost();
  if (!warriorsUnlocked || !canAfford(cost)) return;

  spendResources(cost);
  state.army.warriors += 1;
  addLog("A warrior joins your defenders.");

  if (!state.world.raid.enabled) {
    state.world.raid.enabled = true;
    scheduleNextRaid();
    addLog("Your first warrior has drawn attention. Future waves will now come every 10 to 20 minutes.");
  }

  markDirty();
  renderAll();
}

function requestBuild(buildingId) {
  const building = getBuildingDefinition(buildingId);
  if (!building || state.age < building.minAge || !canAfford(building.cost) || getOpenPlots() <= 0) return;
  state.pendingBuild = buildingId;
  state.activeTab = "civilisation";
  markDirty();
  renderAll();
}

function placePendingBuild(index) {
  if (!state.pendingBuild || state.grid[index]) return;
  const building = getBuildingDefinition(state.pendingBuild);
  if (!building || !canAfford(building.cost)) return;

  spendResources(building.cost);
  state.grid[index] = building.id;
  state.pendingBuild = null;
  clampAssignments();
  addLog(`${building.name} built on plot ${index + 1}.`);

  const counts = getBuildingCounts();
  if (building.id === "lumber_camp" && counts.lumber_camp === 1) addLog("Wood clicking is now unlocked.");
  if (building.id === "quarry" && counts.quarry === 1) addLog("Stone clicking is now unlocked.");
  if (building.id === "forge" && counts.forge === 1) addLog("Metal clicking is now unlocked.");
  if (building.id === "archive" && counts.archive === 1) addLog("Knowledge clicking is now unlocked.");

  markDirty();
  renderAll();
}

function advanceAge() {
  const nextAge = getNextAge();
  if (!nextAge || !canAdvanceAge()) return;
  spendResources(nextAge.cost);
  state.age += 1;
  addLog(`Your settlement advances into the ${ages[state.age].name}.`);
  markDirty();
  renderAll();
}

function expandMap() {
  const cost = getMapExpansionCost();
  if (state.grid.length >= MAX_PLOTS || !canAfford(cost)) return;

  spendResources(cost);
  for (let index = 0; index < EXPANSION_SIZE; index += 1) {
    state.grid.push(null);
  }
  state.mapExpansions += 1;
  addLog(`The map expands by ${EXPANSION_SIZE} new plots.`);
  markDirty();
  renderAll();
}

function recruitExplorer() {
  const cost = getRecruitExplorerCost();
  if (!canAfford(cost)) return;
  spendResources(cost);
  const explorer = createExplorer(`adventurer${state.explorers.roster.length + 1}`, "adventurer");
  state.explorers.roster.push(explorer);
  state.explorers.selectedId = explorer.id;
  addLog(`${explorer.name} joins the expedition roster.`);
  markDirty();
  renderAll();
}

function recruitVillageScout() {
  if (!state.world.villageScoutsUnlocked) return;
  const cost = getRecruitVillageScoutCost();
  if (!canAfford(cost)) return;
  spendResources(cost);
  const scout = createExplorer(`scout${state.explorers.roster.length + 1}`, "village_scout");
  scout.cloak = "moss";
  scout.accent = "forest";
  state.explorers.roster.push(scout);
  state.explorers.selectedId = scout.id;
  addLog(`${scout.name} is hired as a village scout.`);
  markDirty();
  renderAll();
}

function craftItem(recipeId) {
  const selected = getSelectedExplorer();
  const recipe = getRecipe(recipeId);
  if (!recipe || selected.type === "village_scout" || selected.crafted[recipeId] || state.age < recipe.minAge || !canAfford(recipe.cost)) return;

  spendResources(recipe.cost);
  selected.crafted[recipeId] = true;
  if (recipe.slot === "weapon") selected.equippedWeapon = recipeId;
  if (recipe.slot === "armor") selected.equippedArmor = recipeId;
  addLog(`${recipe.name} crafted for ${selected.name}.`);
  markDirty();
  renderAll();
}

function equipItem(recipeId) {
  const selected = getSelectedExplorer();
  const recipe = getRecipe(recipeId);
  if (!recipe || !selected.crafted[recipeId]) return;
  if (recipe.slot === "weapon") selected.equippedWeapon = recipeId;
  if (recipe.slot === "armor") selected.equippedArmor = recipeId;
  markDirty();
  renderAll();
}

function startExpedition(expeditionId) {
  const expedition = expeditions.find((entry) => entry.id === expeditionId);
  const selected = getSelectedExplorer();
  if (!expedition || !selected || selected.type !== "adventurer" || selected.mission || !isExpeditionUnlocked(expedition, selected) || !canAfford(expedition.cost)) return;

  spendResources(expedition.cost);
  const duration = getAdjustedDuration(selected, expedition.duration);
  const rewards = buildRewardMap(expedition.rewards, archetypes[selected.archetype].rewardMultiplier);
  const xp = Math.round(expedition.xp * archetypes[selected.archetype].xpMultiplier);

  selected.mission = {
    id: expedition.id,
    kind: "expedition",
    name: expedition.name,
    description: expedition.description,
    rewards,
    xp,
    endsAt: Date.now() + duration * 1000,
    reported: duration === 0,
  };

  addLog(`${selected.name} leaves for ${expedition.name}.`);
  if (duration === 0) addLog(`${selected.name} somehow returns instantly.`);
  markDirty();
  renderAll();
}

function startVillageScoutMission(explorerId, cost) {
  const scout = getExplorerById(explorerId);
  if (!scout || scout.type !== "village_scout" || scout.mission || !canAfford(cost)) return;

  spendResources(cost);
  const duration = getAdjustedDuration(scout, 3600);
  scout.mission = {
    id: `village-search-${Date.now()}`,
    kind: "village_search",
    name: "Village Search",
    description: "Searching the frontier for a nearby village.",
    rewards: createEmptyResourceMap(),
    xp: 75,
    villageName: generateVillageName(),
    endsAt: Date.now() + duration * 1000,
    reported: duration === 0,
  };

  addLog(`${scout.name} sets out to search for a village.`);
  if (duration === 0) addLog(`${scout.name} somehow completes the search instantly.`);
  markDirty();
  renderAll();
}

function generateVillageName() {
  const starts = ["Oak", "Stone", "Green", "Sun", "River", "Ash", "Mist", "Iron"];
  const ends = ["haven", "field", "watch", "gate", "ford", "grove", "cross", "rest"];
  return `${starts[randomInt(0, starts.length - 1)]}${ends[randomInt(0, ends.length - 1)]}`;
}

function claimMission(explorerId) {
  const explorer = getExplorerById(explorerId);
  if (!explorer || !explorer.mission || !explorer.mission.reported) return;

  const mission = explorer.mission;
  if (mission.kind === "expedition") {
    addResources(mission.rewards);
    explorer.xp += mission.xp;
    addLog(`${explorer.name} returns from ${mission.name} with rewards and ${mission.xp} XP.`);
  } else if (mission.kind === "village_search") {
    explorer.xp += mission.xp;
    state.world.villages.push({
      id: `village-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: mission.villageName,
      support: 1,
      trades: 0,
      tradeCooldownUntil: 0,
    });
    addLog(`${explorer.name} discovers ${mission.villageName}. It can now trade and support your defense.`);
  }

  explorer.mission = null;
  markDirty();
  renderAll();
}

function tradeWithVillage(villageId) {
  const village = state.world.villages.find((entry) => entry.id === villageId);
  if (!village) return;
  const cost = getVillageTradeCost(village);
  if (Date.now() < village.tradeCooldownUntil || !canAfford(cost)) return;

  spendResources(cost);
  const rewards = createEmptyResourceMap();
  rewards.influence = randomInt(24, 42);
  rewards.wood = randomInt(10, 28);
  rewards.stone = randomInt(0, 16);
  addResources(rewards);
  village.trades += 1;
  village.support += 1;
  village.tradeCooldownUntil = Date.now() + 10 * 60 * 1000;
  addLog(`${village.name} sends supplies and more help to fight.`);
  markDirty();
  renderAll();
}

function setActiveTab(tab) {
  if (!state) return;
  state.activeTab = tab;
  markDirty();
  renderTabs();
}

UI.tabButtons.forEach((button) => {
  button.addEventListener("click", () => setActiveTab(button.dataset.tab));
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state) {
    const now = Date.now();
    const seconds = Math.max(0, Math.min((now - state.lastTick) / 1000, 60 * 30));
    state.lastTick = now;
    state.world.elapsedSeconds += seconds;
    applyProduction(seconds);
    processWorldEvents();
    markDirty();
    renderAll();
  }
});

window.setInterval(() => {
  if (!state) return;

  const now = Date.now();
  const seconds = (now - state.lastTick) / 1000;
  state.lastTick = now;
  state.world.elapsedSeconds += seconds;
  applyProduction(seconds);
  processWorldEvents();
  markDirty();

  if (Date.now() - lastFullRender >= 1000) {
    renderAll();
  } else {
    renderResourceRibbon();
    renderSummary();
    renderFrontier();
  }
}, 250);

window.setInterval(() => {
  flushSave();
}, 5000);

window.addEventListener("beforeunload", () => {
  flushSave(true);
});

(function init() {
  const offlineSave = loadOffline();

  if (offlineSave) {
    state = normalizeState(offlineSave);
  } else {
    state = createInitialState();
  }

  applyOfflineProgress();

  renderAll();

  setInterval(() => {
    saveOffline();
  }, 5000);
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js");
  });
}

