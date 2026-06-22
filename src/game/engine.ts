// The simulation. update(state, dt) drives everything; no canvas/DOM here.

import { CONFIG } from "./config";
import {
  ENEMY_AOE,
  ENEMY_AOE_ENRAGED,
  ENEMY_CLAW,
  ENEMY_CLAW_ENRAGED,
  ENEMY_LINE,
  ENEMY_LINE_ENRAGED,
  autoAttackFor,
} from "./actions";
import {
  applyDamage,
  applyHeal,
  applyHot,
  autoAttackers,
  enemy,
  enemyTargetPriority,
  findEntity,
  frontmostLiving,
  livingParty,
  tickHots,
} from "./combat";
import type {
  ActionDef,
  ActionInstance,
  Entity,
  GameState,
  HotInstance,
} from "./types";
import { isDPS } from "./types";

/** How long finished events are kept around for the UI to animate. */
const EVENT_TTL = 3.0;

/** Build a fresh battle: the party holds a fixed formation facing the enemy in a
 * vertical column. Top to bottom — enemy, tank (it soaks the enemy's focus),
 * ranger + mage flanking the middle row, the healer (you) safe in the back.
 * Enemy / tank / healer share the centered column (q + r/2 = 0 keeps x = 0);
 * the enemy sits two rows up so an empty row gaps it off the tank. Immobile. */
export function createInitialState(): GameState {
  const entities: Entity[] = [
    makeEntity("enemy", "enemy", "Ogre", CONFIG.enemy.maxHp, 0, { q: 1, r: -2 }),
    makeEntity("tank", "tank", "Tank", CONFIG.tank.maxHp, 0, { q: 0, r: 0 }),
    makeEntity("ranger", "ranger", "Ranger", CONFIG.ranger.maxHp, 0, { q: -1, r: 1 }),
    makeEntity("mage", "mage", "Mage", CONFIG.mage.maxHp, 0, { q: 0, r: 1 }),
    makeEntity("healer", "healer", "Healer", CONFIG.healer.maxHp, CONFIG.healer.maxMana, { q: -1, r: 2 }),
  ];

  const state: GameState = {
    entities,
    phase: "playing",
    elapsedTime: 0,
    events: [],
    stats: {
      damageDealt: 0,
      healingDone: 0,
      overhealing: 0,
      deaths: 0,
    },
  };

  // The enemy starts acting immediately; the party auto-attacks from frame one.
  startEnemyAction(state);
  return state;
}

function makeEntity(
  id: string,
  kind: Entity["kind"],
  name: string,
  maxHp: number,
  maxMana: number,
  hex: Entity["hex"],
): Entity {
  return {
    id,
    name,
    kind,
    hp: maxHp,
    maxHp,
    mana: maxMana,
    maxMana,
    hex,
    hots: [],
    cooldowns: {},
    alive: true,
    actionCount: 0,
    enraged: false,
  };
}

/** Full legality check for starting an action: caster + target alive, mana,
 * cooldown. */
function validateOrder(
  state: GameState,
  caster: Entity,
  def: ActionDef,
  targetId?: string,
): boolean {
  if (!caster.alive) return false;

  const target = targetId
    ? findEntity(state, targetId)
    : def.targeting === "enemy"
      ? enemy(state)
      : undefined;
  if (targetId && (!target || !target.alive)) return false;
  if (def.targeting === "enemy" && (!target || !target.alive)) return false;

  if (def.manaCost !== undefined && caster.mana < def.manaCost) return false;
  if ((caster.cooldowns[def.id] ?? 0) > 0) return false;
  return true;
}

/** Begin an action on an entity, replacing whatever it was doing. Validates
 * target/mana/cooldown so an illegal order is ignored. Mana and cooldown are
 * checked here but only *spent/started* on completion, so replacing a cast (or a
 * mis-click) never wastes them.
 * Returns the started instance, or undefined if the order was illegal. */
function startAction(
  state: GameState,
  casterId: string,
  def: ActionDef,
  targetId?: string,
  secondaryTargetId?: string,
): ActionInstance | undefined {
  const caster = findEntity(state, casterId);
  if (!caster) return undefined;
  if (!validateOrder(state, caster, def, targetId)) return undefined;

  const target = targetId
    ? findEntity(state, targetId)
    : def.targeting === "enemy"
      ? enemy(state)
      : undefined;
  caster.current = {
    def,
    elapsed: 0,
    targetId: target?.id ?? targetId,
    secondaryTargetId,
  };
  return caster.current;
}

/** The single entry point for player/bot orders. There is no queue: an order
 * issued while the caster is already casting *replaces* that cast (mana/cooldown
 * only commit on completion, so interrupting an in-progress cast wastes nothing).
 * An illegal order (dead target, not enough mana, on cooldown) is ignored and
 * leaves the current cast untouched. */
export function issueOrder(
  state: GameState,
  casterId: string,
  def: ActionDef,
  targetId?: string,
): void {
  startAction(state, casterId, def, targetId);
}

/** Abort the current cast (free — mana/cooldown only commit on completion): the
 * emergency "stop, then re-cast" play. */
export function cancelCast(state: GameState, casterId: string): void {
  const caster = findEntity(state, casterId);
  if (!caster || !caster.alive || !caster.current) return;
  caster.current = undefined;
}

/** Which living party member the enemy single-target Claws: the tank, then a
 * random living damage dealer, then the healer. Shares frontmostLiving's
 * priority skeleton but picks the DPS at random (vs frontmostLiving's
 * deterministic first DPS) — that divergence is intentional. */
function clawTargetId(state: GameState): string | undefined {
  return enemyTargetPriority(
    state,
    (dps) => dps[Math.floor(Math.random() * dps.length)],
  )?.id;
}

/** Enemy decision-making: a fixed rotation indexed by completed combat actions.
 * - "aoe": hit all living party (the scary, telegraphed spike).
 * - "line": hit the frontmost living member + one random other (the only regular
 *   way to reach the healer).
 * - otherwise: a single-target Claw on the priority target (tank first). */
function startEnemyAction(state: GameState): void {
  const e = enemy(state);
  if (!e || !e.alive) return;
  const party = livingParty(state);
  if (party.length === 0) return;

  const rotation = CONFIG.enemy.rotation;
  const slot = rotation[e.actionCount % rotation.length];

  const claw = e.enraged ? ENEMY_CLAW_ENRAGED : ENEMY_CLAW;
  const line = e.enraged ? ENEMY_LINE_ENRAGED : ENEMY_LINE;
  const aoe = e.enraged ? ENEMY_AOE_ENRAGED : ENEMY_AOE;

  if (slot === "aoe") {
    startAction(state, e.id, aoe);
    return;
  }
  if (slot === "line") {
    const primary = frontmostLiving(state);
    const others = party.filter((p) => p !== primary);
    const secondary =
      others.length > 0
        ? others[Math.floor(Math.random() * others.length)]
        : undefined;
    startAction(state, e.id, line, primary?.id, secondary?.id);
    return;
  }
  startAction(state, e.id, claw, clawTargetId(state));
}

/** Attackers never stand around: any idle tank/ranger/mage auto-casts its own
 * attack. */
function startAutoAttacks(state: GameState): void {
  for (const a of autoAttackers(state)) {
    if (!a.alive || a.current) continue;
    startAction(state, a.id, autoAttackFor(a.kind));
  }
}

/** Resolve a completed action's effect, spending mana and starting its cooldown. */
function resolveAction(state: GameState, caster: Entity): void {
  const inst = caster.current;
  if (!inst) return;
  const { def } = inst;

  if (def.manaCost !== undefined) {
    caster.mana = Math.max(0, caster.mana - def.manaCost);
  }
  if (def.cooldown) {
    caster.cooldowns[def.id] = def.cooldown;
  }

  switch (def.effect.kind) {
    case "damage": {
      const target = inst.targetId
        ? findEntity(state, inst.targetId)
        : enemy(state);
      const finalTarget = target ?? enemy(state);
      if (finalTarget && finalTarget.alive) {
        applyDamage(state, finalTarget, def.effect.amount);
      }
      break;
    }
    case "heal": {
      const target = inst.targetId ? findEntity(state, inst.targetId) : undefined;
      if (target && target.alive) applyHeal(state, target, def.effect.amount);
      break;
    }
    case "hot": {
      const target = inst.targetId ? findEntity(state, inst.targetId) : undefined;
      if (target && target.alive) {
        const hot: HotInstance = {
          perTick: def.effect.perTick,
          interval: def.effect.interval,
          duration: def.effect.duration,
          sinceTick: 0,
        };
        applyHot(target, hot);
      }
      break;
    }
    case "aoe-heal": {
      for (const p of livingParty(state)) applyHeal(state, p, def.effect.amount);
      break;
    }
    case "aoe-damage": {
      for (const p of livingParty(state)) applyDamage(state, p, def.effect.amount);
      break;
    }
    case "line-damage": {
      const primary = inst.targetId
        ? findEntity(state, inst.targetId)
        : frontmostLiving(state);
      if (primary && primary.alive) applyDamage(state, primary, def.effect.amount);
      const secondary = inst.secondaryTargetId
        ? findEntity(state, inst.secondaryTargetId)
        : undefined;
      if (secondary && secondary.alive && secondary !== primary) {
        applyDamage(state, secondary, def.effect.amount);
      }
      break;
    }
  }
}

/** Advance the whole simulation by dt seconds. */
export function update(state: GameState, dt: number): void {
  if (state.phase !== "playing") return;

  state.elapsedTime += dt;

  // 1. Resources, cooldowns, and timed effects.
  for (const e of state.entities) {
    if (!e.alive) continue;
    if (e.maxMana > 0) {
      e.mana = Math.min(e.maxMana, e.mana + CONFIG.healer.manaRegen * dt);
    }
    for (const id in e.cooldowns) {
      e.cooldowns[id] -= dt;
      if (e.cooldowns[id] <= 0) delete e.cooldowns[id];
    }
  }
  tickHots(state, dt);

  // 2. Advance casts and resolve completed ones.
  for (const e of state.entities) {
    if (!e.alive || !e.current) continue;
    e.current.elapsed += dt;
    if (e.current.elapsed >= e.current.def.castTime) {
      resolveAction(state, e);
      e.current = undefined;
      if (e.kind === "enemy") {
        e.actionCount += 1;
        if (e.alive) startEnemyAction(state);
      }
    }
  }

  // 2a. Idle attackers swing automatically.
  startAutoAttacks(state);

  // 2b. Keep the enemy busy (it never idles while the party lives).
  const en = enemy(state);
  if (en && en.alive && !en.current && livingParty(state).length > 0) {
    startEnemyAction(state);
  }

  // 3. Enrage when the enemy drops below the threshold. The current cast finishes
  // as-is; the next action uses the enraged stats.
  if (
    en &&
    en.alive &&
    !en.enraged &&
    en.hp <= en.maxHp * CONFIG.enemy.enrage.hpFraction
  ) {
    en.enraged = true;
    state.events.push({ kind: "enrage", entityId: en.id, at: state.elapsedTime });
  }

  // 4. Clean up: dead casters drop their action; clear a stale armed spell.
  for (const e of state.entities) {
    if (!e.alive) e.current = undefined;
  }
  if (state.armedSpellId) {
    const h = state.entities.find((e) => e.kind === "healer");
    if (!h || !h.alive) state.armedSpellId = undefined;
  }

  // 5. Win/lose. You lose if the party is wiped OR no damage dealer remains: the
  // healer alone can't kill the enemy, so the fight is unwinnable -> a loss.
  if (en && !en.alive) {
    state.phase = "won";
  } else {
    const living = livingParty(state);
    const canStillWin = living.some((e) => e.kind === "tank" || isDPS(e));
    if (living.length === 0 || !canStillWin) state.phase = "lost";
  }

  // 6. Drop events the UI is done animating.
  state.events = state.events.filter(
    (ev) => ev.at > state.elapsedTime - EVENT_TTL,
  );
}
