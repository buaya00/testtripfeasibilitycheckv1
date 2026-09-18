import { useState } from "react";
import { Fuel, ChevronDown, ChevronUp, Construction } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LegData } from "./tripTypes";
import type { FlightLegCalculation } from "@/lib/flightCalculations";

interface Props {
  legs: LegData[];
  flightCalcs: Record<number, FlightLegCalculation>;
  aircraftType: string;
  onUpdateLegFuelPrice: (legIndex: number, priceUsd: number | null, note: string) => void;
}

export default function FuelTankeringPanel({ legs }: Props) {
  const [expanded, setExpanded] = useState(true);

  // Only show if there are multiple legs (at least one flight segment)
  if (legs.length < 2) return null;

  return (
    <Card className="opacity-60">
      <CardHeader className="pb-3">
        <button
          type="button"
          className="flex w-full items-center text-left gap-2"
          onClick={() => setExpanded(!expanded)}
        >
          <CardTitle className="text-base flex items-center gap-2 text-muted-foreground">
            <Fuel className="h-4 w-4" />
            Fuel Tankering Analysis
          </CardTitle>
          {expanded ? <ChevronUp className="h-4 w-4 ml-2 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 ml-2 text-muted-foreground" />}
        </button>
      </CardHeader>

      {expanded && (
        <CardContent>
          <div className="flex items-center justify-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-6 text-sm text-muted-foreground">
            <Construction className="h-4 w-4" />
            Under construction
          </div>
        </CardContent>
      )}
    </Card>
  );
}
