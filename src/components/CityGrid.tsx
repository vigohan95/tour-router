"use client";

import { AgGridReact } from "ag-grid-react";
import type { CellValueChangedEvent, ColDef, ICellRendererParams, RowClassRules } from "ag-grid-community";
import { useCallback, useMemo, useState } from "react";
import type { Itinerary, RankedCity } from "@/lib/tour/types";
import { pct, useGridTheme } from "./grid";

interface Row extends RankedCity {
  stop: number | null;
  hasPartners: boolean;
  venue: string;
}

function ScoreBar(p: ICellRendererParams<Row, number>) {
  const v = p.value ?? 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 overflow-hidden rounded bg-border">
        <div className="h-full bg-accent" style={{ width: `${Math.round(v * 100)}%` }} />
      </div>
      <span className="tabular-nums">{pct(v)}</span>
    </div>
  );
}

export default function CityGrid({ candidates, itinerary, partnersFor, onExclude, onReorder, onAsk }: { candidates: RankedCity[]; itinerary?: Itinerary; partnersFor: string[]; onExclude: (city: string, excluded: boolean) => void; onReorder: (cities: string[]) => void; onAsk: (prompt: string) => void }) {
  const theme = useGridTheme();
  const [quick, setQuick] = useState("");

  const rows = useMemo<Row[]>(() => {
    const stopOf = new Map(itinerary?.stops.map((s) => [s.city, s.order]) ?? []);
    return candidates.map((c) => ({ ...c, stop: stopOf.get(c.city) ?? null, hasPartners: partnersFor.includes(c.city), venue: itinerary?.stops.find((s) => s.city === c.city)?.venue?.name ?? "" }));
  }, [candidates, itinerary, partnersFor]);

  const columnDefs = useMemo<ColDef<Row>[]>(
    () => [
      { field: "rank", headerName: "#", width: 60, pinned: "left", sort: "asc" },
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
      { field: "score", headerName: "Fan affinity", width: 160, cellRenderer: ScoreBar },
      { field: "venue", headerName: "Venue", flex: 1, minWidth: 160 },
      { field: "cells", headerName: "Cells", width: 80, headerTooltip: "Heatmap cells sampled for this market" },
      { field: "excludedReason", headerName: "Why excluded", width: 160 },
      { headerName: "", width: 80, sortable: false, filter: false, cellRenderer: (p: ICellRendererParams<Row>) => (p.data ? <button className="text-xs text-accent underline" onClick={() => onAsk(`Why ${p.data!.city}?`)}>why?</button> : null) },
    ],
    [onAsk],
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
        <p className="mt-1">No cities ranked yet. Select an act and ask the agent to plan the tour; it ranks every candidate market by Qloo heatmap affinity.</p>
      </div>
    );
  }

  return (
    <div className="card flex h-[420px] flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold">2. Markets</div>
        <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Filter cities" className="w-48 rounded-md border border-border bg-background px-3 py-1 text-sm outline-none focus:border-accent" />
        <span className="text-xs text-muted">{candidates.length} ranked by heatmap affinity. Tick Exclude to drop a city; edit Stop to re-order the route.</span>
      </div>
      <div className="min-h-0 flex-1">
        <AgGridReact<Row> theme={theme} rowData={rows} columnDefs={columnDefs} defaultColDef={{ sortable: true, filter: true, resizable: true }} getRowId={(p) => p.data.city} onCellValueChanged={onCellValueChanged} rowClassRules={rowClassRules} quickFilterText={quick} animateRows tooltipShowDelay={300} singleClickEdit />
      </div>
    </div>
  );
}
