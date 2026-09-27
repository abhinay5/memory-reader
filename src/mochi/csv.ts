import type { CardCandidate, Source } from "../types";
import { neutralizeSideSeparators } from "./format";

// Two effective columns only (Front, Back): extra columns would become extra card sides
// on a plain Mochi CSV import.

export function csvEscape(value: string): string {
  const v = value.replace(/\r\n?/g, "\n");
  return /[",\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function cardsToCsv(
  rows: { card: Pick<CardCandidate, "front" | "back">; source: Pick<Source, "title" | "author" | "url"> }[],
  options: { includeSourceLink: boolean; header?: boolean } = { includeSourceLink: true },
): string {
  const lines: string[] = [];
  if (options.header !== false) lines.push("Front,Back");
  for (const { card, source } of rows) {
    const provenance = [`Source: ${source.title}${source.author ? ` — ${source.author}` : ""}`];
    if (options.includeSourceLink && source.url) provenance.push(source.url);
    const back = `${neutralizeSideSeparators(card.back)}\n\n${provenance.join("\n")}`;
    lines.push(`${csvEscape(neutralizeSideSeparators(card.front))},${csvEscape(back)}`);
  }
  return lines.join("\r\n") + "\r\n";
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
