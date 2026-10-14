"use client";

import { AgGridReact } from "ag-grid-react";
import type { CellValueChangedEvent, ColDef, ICellRendererParams, RowClassRules } from "ag-grid-community";
import { useCallback, useMemo, useState } from "react";
import type { Itinerary, RankedCity } from "@/lib/tour/types";
import { pct, pct1, useGridTheme } from "./grid";

interface Row extends RankedCity {
  stop: number | null;
  hasPartners: boolean;
  venue: string;
}

/** Bar = 0..100 index across the candidates; text = Qloo's affinity (one decimal). */
function ScoreBar(p: ICellRendererParams<Row, number>) {
  if (p.data?.noSignal) return <span className="text-xs text-muted">unscored</span>;
  const index = p.data?.index ?? 0;
  const v = p.value ?? 0;
  return (
    <div className="flex items-center gap-2" title={`Qloo heatmap affinity ${(v * 100).toFixed(2)}% (mean of the strongest cells within 60 km, one country-wide map); index ${index}/100 across the ranked candidates`}>
      <div className="h-2 w-20 overflow-hidden rounded bg-border">
        <div className="h-full bg-accent" style={{ width: `${index}%` }} />
      </div>
      <span className="tabular-nums">{pct1(v)}</span>
    </div>
  );
}

/** Taste lift = population rank - taste rank. Warm = taste says more than size; cool = a big metro the fans care less about. */
function LiftCell(p: ICellRendererParams<Row, number>) {
  if (p.data?.noSignal) return null;
  const v = p.value ?? 0;
  const tone = v > 0 ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" : v < 0 ? "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200" : "text-muted";
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${tone}`} title={`#${p.data?.rank} by taste vs #${p.data?.populationRank} by metro size`}>
      {v > 0 ? `+${v}` : v}
    </span>
  );
}

export default function CityGrid({ candidates, itinerary, partnersFor, onExclude, onReorder, onAsk, openerName }: { candidates: RankedCity[]; itinerary?: Itinerary; partnersFor: string[]; onExclude: (city: string, excluded: boolean) => void; onReorder: (cities: string[]) => void; onAsk: (prompt: string) => void; openerName?: string }) {
  const theme = useGridTheme();
  const [quick, setQuick] = useState("");
  const hasJoint = candidates.some((c) => c.jointScore !== undefined);

  const rows = useMemo<Row[]>(() => {
    const stopOf = new Map(itinerary?.stops.map((s) => [s.city, s.order]) ?? []);
    return candidates.map((c) => ({ ...c, stop: stopOf.get(c.city) ?? null, hasPartners: partnersFor.includes(c.city), venue: itinerary?.stops.find((s) => s.city === c.city)?.venue?.name ?? "" }));
  }, [candidates, itinerary, partnersFor]);

  const columnDefs = useMemo<ColDef<Row>[]>(
    () => [
      { field: "rank", headerName: "#", width: 60, pinned: "left", sort: "asc", headerTooltip: "Rank by fan affinity (taste)" },
      { field: "city", headerName: "City", width: 140, pinned: "left" },
      {
        field: "stop",
        headerName: "Stop",
        width: 80,
        editable: (p) => !!p.data && !p.data.excluded && p.data.stop !== null,
        cellEditor: "agNumberCellEditor",
        cellEditorParams: { min: 1, precision: 0 },
        valueFormatter: (p) => (p.value === null || p.value === undefined ? "" : `#${p.value}`),
        cellClass: (p) => (p.value ? "font-semibold cursor-pointer" : "text-muted"),
        headerTooltip: "Edit the number to move a stop; the route keeps your order",
      },
      {
        field: "excluded",
        headerName: "Exclude",
        width: 90,
        editable: true,
        cellRenderer: "agCheckboxCellRenderer",
        cellEditor: "agCheckboxCellEditor",
        valueGetter: (p) => !!p.data?.excluded,
        valueSetter: (p) => {
          if (p.data) p.data.excluded = !!p.newValue || undefined;
          return true;
        },
      },
      { field: "country", headerName: "Country", width: 90 },
      { field: "score", headerName: "Fan affinity", width: 170, cellRenderer: ScoreBar, headerTooltip: "Qloo heatmap affinity of the act's fans around this city (one country-wide heatmap, cells within 60 km); bar = index across the candidates" },
      { field: "lift", headerName: "Taste lift", width: 100, cellRenderer: LiftCell, headerTooltip: "Population rank minus taste rank: +N = this city matters more for the act than its size suggests; -N = a big metro whose population cares less" },
      { field: "populationRank", headerName: "Size #", width: 80, headerTooltip: "Rank by metro population (public figures, not Qloo)" },
      { field: "jointScore", headerName: "Co-bill", width: 100, hide: !hasJoint, valueFormatter: (p) => (p.value === undefined || p.value === null ? "" : pct1(p.value)), headerTooltip: `Affinity on a heatmap signalled by the headliner and the tour opener together${openerName ? ` (${openerName})` : ""}; same binning as Fan affinity` },
      { headerName: "Co-bill #", width: 90, hide: !hasJoint, valueGetter: (p) => p.data?.jointRank ?? null, cellRenderer: (p: ICellRendererParams<Row, number | null>) => (p.value === null || p.value === undefined || !p.data ? null : <span className={`tabular-nums ${p.value < p.data.rank ? "text-ok" : p.value > p.data.rank ? "text-bad" : "text-muted"}`} title={`#${p.data.rank} headliner-only -> #${p.value} on the pairing`}>#{p.value}{p.value !== p.data.rank ? ` (${p.value < p.data.rank ? "+" : ""}${p.data.rank - p.value})` : ""}</span>), headerTooltip: "Rank on the joint (co-bill) heatmap vs the headliner-only rank" },
      { field: "popularity", headerName: "Listeners", width: 100, valueFormatter: (p) => (p.data?.noSignal ? "" : pct(p.value)), headerTooltip: "Qloo heatmap popularity of the same cells: how dense the act's listeners are here (volume, not over-index)" },
      { field: "popularityRank", headerName: "Listeners #", width: 100, headerTooltip: "Rank by listener density" },
      { field: "venue", headerName: "Venue", flex: 1, minWidth: 160 },
      { field: "cells", headerName: "Heat cells", width: 100, headerTooltip: "Qloo heatmap cells within 60 km of the city that back the score" },
      { headerName: "Note", width: 200, valueGetter: (p) => p.data?.excludedReason ?? p.data?.note ?? "" },
      {
        headerName: "",
        width: 90,
        sortable: false,
        filter: false,
        cellRenderer: (p: ICellRendererParams<Row>) => {
          if (!p.data) return null;
          const not = !!itinerary && p.data.stop === null;
          return (
            <button className="text-xs text-accent underline" title={not ? "Answers from the heatmap rank, the obvious (population) route and the policy: excluded, radius clause, cap" : "Answers from the rank, the explainability scores and the route position"} onClick={() => onAsk(not ? `Why not ${p.data!.city}?` : `Why ${p.data!.city}?`)}>
              {not ? "why not?" : "why?"}
            </button>
          );
        },
      },
    ],
    [onAsk, hasJoint, openerName, itinerary],
  );

  const rowClassRules = useMemo<RowClassRules<Row>>(
    () => ({
      "opacity-50 line-through": (p) => !!p.data?.excluded,
      "bg-amber-50 dark:bg-amber-950/20": (p) => !!p.data && p.data.stop !== null && !p.data.excluded,
    }),
    [],
  );

  const onCellValueChanged = useCallback(
    (e: CellValueChangedEvent<Row>) => {
      if (!e.data) return;
      if (e.colDef.field === "excluded") onExclude(e.data.city, !!e.newValue);
      if (e.colDef.field === "stop" && itinerary) {
        const target = Math.max(1, Math.min(itinerary.stops.length, Number(e.newValue) || 1));
        const order = itinerary.stops.map((s) => s.city).filter((c) => c !== e.data!.city);
        order.splice(target - 1, 0, e.data.city);
        onReorder(order);
      }
    },
    [onExclude, onReorder, itinerary],
  );

  if (candidates.length === 0) {
    return (
      <div className="card text-sm text-muted">
        <div className="text-sm font-semibold text-foreground">2. Markets</div>
        <p className="mt-1">No cities ranked yet. Select an act and ask the agent to plan the tour; it reads one Qloo heatmap per country for the act and scores every candidate city from the cells around it.</p>
      </div>
    );
  }

  const countries = new Set(candidates.map((c) => c.country));
  return (
    <div className="card flex h-[440px] flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold">2. Markets</div>
        <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Filter cities" className="w-48 rounded-md border border-border bg-background px-3 py-1 text-sm outline-none focus:border-accent" />
        <span className="text-xs text-muted">
          {candidates.length} ranked by Qloo fan affinity{countries.size > 1 ? ` (normalised within each of ${countries.size} countries)` : ""}. <b>Taste lift</b> = size rank minus taste rank. Tick Exclude to drop a city; edit Stop to re-order the route.
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <AgGridReact<Row>
          theme={theme}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, resizable: true }}
          getRowId={(p) => p.data.city}
          onCellValueChanged={onCellValueChanged}
          // A new ranking should read top-down by rank unless the user sorted by another column.
          onRowDataUpdated={(e) => {
            if (!e.api.getColumnState().some((c) => c.sort)) e.api.applyColumnState({ state: [{ colId: "rank", sort: "asc" }], defaultState: { sort: null } });
          }}
          rowClassRules={rowClassRules}
          quickFilterText={quick}
          animateRows
          tooltipShowDelay={300}
          singleClickEdit
        />
      </div>
    </div>
  );
}
