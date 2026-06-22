// Pure skill-tree derivation. Turns a player's purchased skills (nodeId -> ranks)
// into (a) effective party/healer stats and (b) the live ActionDefs for the
// healer's bar and the party's auto-cast abilities. No DOM/canvas; imports only
// config + types so combat.ts and engine.ts can both depend on it (acyclic).

import { CONFIG, SKILL_NODES } from "./config";
import type {
  ActionDef,
  AutoAttackerKind,
  GameState,
  SkillNode,
} from "./types";

/** A player's purchased skills: node id -> ranks owned (absent = 0). */
export type Skills = Record<string, number>;

const NODE_BY_ID = new Map<string, SkillNode>(SKILL_NODES.map((n) => [n.id, n]));

export function skillNode(id: string): SkillNode {
  const n = NODE_BY_ID.get(id);
  if (!n) throw new Error(`unknown skill node "${id}"`);
  return n;
}

/** Ranks owned in a node (0 if unowned). */
export function rankOf(skills: Skills, id: string): number {
  return skills[id] ?? 0;
}

// --- Purchasing -----------------------------------------------------------

/** SP cost of the next rank of a node, or null if already maxed. */
export function nextNodeCost(skills: Skills, id: string): number | null {
  const node = skillNode(id);
  const rank = rankOf(skills, id);
  return rank >= node.maxRank ? null : node.costs[rank];
}

export function prereqsMet(skills: Skills, node: SkillNode): boolean {
  return node.prereqs.every((p) => rankOf(skills, p) > 0);
}

export type PurchaseCheck = {
  ok: boolean;
  reason?: "maxed" | "locked" | "cant-afford";
};

/** Whether the next rank of a node can be bought right now. Shared by the engine
 * (spendSkillPoint) and the UI (node coloring). */
export function canPurchase(
  state: Pick<GameState, "skills" | "skillPoints">,
  id: string,
): PurchaseCheck {
  const node = skillNode(id);
  const rank = rankOf(state.skills, id);
  if (rank >= node.maxRank) return { ok: false, reason: "maxed" };
  if (!prereqsMet(state.skills, node)) return { ok: false, reason: "locked" };
  if (state.skillPoints < node.costs[rank]) return { ok: false, reason: "cant-afford" };
  return { ok: true };
}

// --- Effective stats ------------------------------------------------------

export function effectiveHealer(skills: Skills): {
  maxMana: number;
  manaRegen: number;
} {
  return {
    maxMana: CONFIG.healer.maxMana + 10 * rankOf(skills, "mana-pool"),
    manaRegen: CONFIG.healer.manaRegen + 0.3 * rankOf(skills, "meditation"),
  };
}

export interface RoleStats {
  maxHp: number;
  attackDamage: number;
}

export function effectiveParty(skills: Skills): Record<AutoAttackerKind, RoleStats> {
  return {
    tank: {
      maxHp: CONFIG.tank.maxHp + 15 * rankOf(skills, "tank-training"),
      attackDamage: CONFIG.tank.attack.damage + 2 * rankOf(skills, "heavy-strikes"),
    },
    ranger: {
      maxHp: CONFIG.ranger.maxHp + 10 * rankOf(skills, "ranger-training"),
      attackDamage: CONFIG.ranger.attack.damage + 2 * rankOf(skills, "deadeye"),
    },
    mage: {
      maxHp: CONFIG.mage.maxHp + 10 * rankOf(skills, "mage-training"),
      attackDamage: CONFIG.mage.attack.damage + 2 * rankOf(skills, "arcane-power"),
    },
  };
}

/** Between-fight recovery fractions, raised by Second Wind / Field Rations. */
export function effectiveRecovery(skills: Skills): {
  hpFraction: number;
  manaFraction: number;
  reviveHpFraction: number;
} {
  const rec = CONFIG.recovery;
  const sw = rankOf(skills, "second-wind");
  return {
    hpFraction: rec.hpFraction + 0.05 * sw,
    manaFraction: rec.manaFraction + 0.05 * sw,
    reviveHpFraction: rec.reviveHpFraction + 0.1 * rankOf(skills, "field-rations"),
  };
}

/** Chance for any heal to land at 1.5x (Crit Heals). */
export function critHealChance(skills: Skills): number {
  return 0.1 * rankOf(skills, "crit-heals");
}

/** Overheal Shield absorb-pool cap (0 if the capstone isn't owned). */
export function overhealShieldCap(skills: Skills): number {
  return rankOf(skills, "overheal-shield") > 0
    ? 15 + 5 * rankOf(skills, "reinforced-shield")
    : 0;
}

// --- Healer spell bar -----------------------------------------------------

const clampCast = (t: number) => Math.max(0.1, t);
const clampMana = (m: number) => Math.max(0, m);

/** The healer's live action bar in fixed Q/W/E/R/T order: always Heal, then each
 * unlocked spell with its upgrades folded into the numbers. Ids are stable so
 * cooldowns / armed-spell / audio survive a recompute. */
export function healerSpells(skills: Skills): ActionDef[] {
  const h = CONFIG.healer;
  const r = (id: string) => rankOf(skills, id);
  const spells: ActionDef[] = [
    {
      id: "heal",
      name: "Heal",
      castTime: clampCast(h.slowHeal.castTime - 0.1 * r("swift-heal")),
      cooldown: h.slowHeal.cooldown,
      manaCost: clampMana(h.slowHeal.mana - r("efficient-heal")),
      targeting: "ally-single",
      effect: { kind: "heal", amount: h.slowHeal.heal + 5 * r("potent-heal") },
    },
  ];

  if (r("quick-heal") > 0) {
    spells.push({
      id: "quick-heal",
      name: "Quick Heal",
      castTime: clampCast(h.fastHeal.castTime - 0.1 * r("swift-quick-heal")),
      cooldown: h.fastHeal.cooldown,
      manaCost: clampMana(h.fastHeal.mana - r("efficient-quick-heal")),
      targeting: "ally-single",
      effect: { kind: "heal", amount: h.fastHeal.heal + 2 * r("potent-quick-heal") },
    });
  }
  if (r("regen") > 0) {
    spells.push({
      id: "regen",
      name: "Regen",
      castTime: clampCast(h.hot.castTime - 0.1 * r("swift-regen")),
      cooldown: h.hot.cooldown,
      manaCost: clampMana(h.hot.mana - r("efficient-regen")),
      targeting: "ally-single",
      effect: {
        kind: "hot",
        perTick: h.hot.perTick,
        interval: h.hot.interval,
        duration: h.hot.duration + 2 * r("lingering-regen"),
      },
    });
  }
  if (r("group-heal") > 0) {
    spells.push({
      id: "group-heal",
      name: "Group Heal",
      castTime: clampCast(h.aoeHeal.castTime - 0.1 * r("swift-group-heal")),
      cooldown: h.aoeHeal.cooldown,
      manaCost: clampMana(h.aoeHeal.mana - r("efficient-group-heal")),
      targeting: "party-all",
      effect: { kind: "aoe-heal", amount: h.aoeHeal.heal + 4 * r("wide-grace") },
    });
  }
  if (r("resurrect") > 0) {
    spells.push({
      id: "resurrect",
      name: "Resurrect",
      castTime: h.resurrect.castTime,
      cooldown: h.resurrect.cooldown,
      manaCost: h.resurrect.mana,
      targeting: "ally-dead",
      effect: {
        kind: "revive",
        hpFraction: h.resurrect.reviveFraction + 0.1 * r("greater-resurrection"),
      },
    });
  }
  return spells;
}

// --- Party auto-cast abilities --------------------------------------------

/** Leveled-ability output: base at rank 1, +per for each rank beyond. */
const leveled = (rank: number, base: number, per: number) => base + per * (rank - 1);

/** The unlocked auto-cast abilities for a role, longest-cooldown first (the
 * scheduler casts the first that is off-cooldown and validly targetable, else the
 * basic swing). Offensive abilities target the focus; self/party buffs need no
 * target. Only abilities with >= 1 rank are returned. */
export function partyAbilities(
  kind: AutoAttackerKind,
  skills: Skills,
): ActionDef[] {
  const r = (id: string) => rankOf(skills, id);
  const out: ActionDef[] = [];

  if (kind === "tank") {
    if (r("bulwark") > 0) {
      out.push({
        id: "bulwark", name: "Bulwark", castTime: 1.0, cooldown: 60,
        targeting: "party-all", effect: { kind: "shield", hits: 1, scope: "party-all" },
      });
    }
    if (r("thorns") > 0) {
      out.push({
        id: "thorns", name: "Thorns", castTime: 0.5, cooldown: 20,
        targeting: "party-all", effect: { kind: "thorns", pct: 0.1 * r("thorns"), duration: 10 },
      });
    }
    if (r("shield-wall") > 0) {
      out.push({
        id: "shield-wall", name: "Shield Wall", castTime: 0.5, cooldown: 15,
        targeting: "party-all", effect: { kind: "shield", hits: r("shield-wall"), scope: "self" },
      });
    }
  } else if (kind === "ranger") {
    if (r("serpent-sting") > 0) {
      out.push({
        id: "serpent-sting", name: "Serpent Sting", castTime: 1.0, cooldown: 10,
        targeting: "enemy",
        effect: { kind: "dot", perTick: leveled(r("serpent-sting"), 4, 1), interval: 1.0, duration: 8 },
      });
    }
    if (r("volley") > 0) {
      out.push({
        id: "volley", name: "Volley", castTime: 1.5, cooldown: 15,
        targeting: "enemy",
        effect: { kind: "line-damage", amount: leveled(r("volley"), 12, 4), count: 3 },
      });
    }
    if (r("aimed-shot") > 0) {
      out.push({
        id: "aimed-shot", name: "Aimed Shot", castTime: 1.5, cooldown: 10,
        targeting: "enemy",
        effect: { kind: "damage", amount: leveled(r("aimed-shot"), 35, 10) },
      });
    }
  } else if (kind === "mage") {
    if (r("arcane-conduit") > 0) {
      out.push({
        id: "arcane-conduit", name: "Arcane Conduit", castTime: 2.0, cooldown: 20,
        targeting: "party-all",
        effect: { kind: "mana-restore", amount: leveled(r("arcane-conduit"), 10, 5) },
      });
    }
    if (r("firestorm") > 0) {
      out.push({
        id: "firestorm", name: "Firestorm", castTime: 2.0, cooldown: 20,
        targeting: "enemy",
        effect: { kind: "aoe-enemy-damage", amount: leveled(r("firestorm"), 20, 6) },
      });
    }
    if (r("fireball") > 0) {
      out.push({
        id: "fireball", name: "Fireball", castTime: 2.0, cooldown: 15,
        targeting: "enemy",
        effect: { kind: "damage", amount: leveled(r("fireball"), 45, 12) },
      });
    }
  }
  return out;
}
