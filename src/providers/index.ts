import type { ReactElement } from "react";
import { hugeiconsProvider } from "./hugeicons.js";
import { lucideProvider } from "./lucide.js";
import type { IconProvider, RenderOptions } from "./types.js";

/** Add a new icon family by implementing IconProvider and listing it here — nothing else changes. */
export const providers: IconProvider[] = [hugeiconsProvider, lucideProvider];

export interface QualifiedIcon {
  /** `${providerId}:${name}` — globally unique across every registered family. */
  qualifiedName: string;
  description: string;
}

/** Only the providers whose id is in `familyIds`, or every provider when it's omitted. */
function selectProviders(familyIds?: readonly string[]): IconProvider[] {
  return familyIds ? providers.filter((p) => familyIds.includes(p.id)) : providers;
}

/** The flat list of icon concepts across the selected providers (all of them by default). No categorization, no filtering beyond family. */
export function getAllCandidates(familyIds?: readonly string[]): QualifiedIcon[] {
  return selectProviders(familyIds).flatMap((provider) =>
    provider.listIcons().map((icon) => ({
      qualifiedName: `${provider.id}:${icon.name}`,
      description: `${icon.description} (${provider.id})`,
    })),
  );
}

export interface FamilyCount {
  id: string;
  label: string;
  count: number;
}

export function getCandidateCountsByProvider(familyIds?: readonly string[]): FamilyCount[] {
  return selectProviders(familyIds).map((provider) => ({ id: provider.id, label: provider.label, count: provider.listIcons().length }));
}

/**
 * Validates a client-supplied `families` value: omitted means every family; otherwise it must
 * be a non-empty array of known provider ids. Returns null when invalid.
 */
export function parseFamilies(value: unknown): string[] | null {
  if (value === undefined) return providers.map((p) => p.id);
  if (!Array.isArray(value) || value.length === 0) return null;
  const known = new Set(providers.map((p) => p.id));
  if (!value.every((id) => typeof id === "string" && known.has(id))) return null;
  return [...new Set(value as string[])];
}

export function renderQualified(qualifiedName: string, opts: RenderOptions): ReactElement {
  const [providerId, ...rest] = qualifiedName.split(":");
  const name = rest.join(":");
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) throw new Error(`Unknown icon provider: ${providerId}`);
  return provider.renderElement(name, opts);
}
