import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AIRCRAFT_CATEGORIES } from "@/data/aircraftData";

interface Props {
  value: string;
  onChange: (value: string) => void;
  hasError?: boolean;
}

export function AircraftTypeCombobox({ value, onChange, hasError }: Props) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  // Filter categories/types by query
  const filtered = React.useMemo(() => {
    if (!query.trim()) return AIRCRAFT_CATEGORIES;
    const q = query.toLowerCase();
    return AIRCRAFT_CATEGORIES
      .map((cat) => ({
        ...cat,
        types: cat.types.filter((t) => t.toLowerCase().includes(q)),
      }))
      .filter((cat) => cat.types.length > 0);
  }, [query]);

  const handleSelect = (type: string) => {
    onChange(type === value ? "" : type);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between font-normal",
            !value && "text-muted-foreground",
            hasError && "border-destructive ring-1 ring-destructive"
          )}
        >
          <span className="truncate">{value || "Select aircraft"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0 z-50 bg-popover border shadow-md"
        align="start"
        sideOffset={4}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search aircraft…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <CommandEmpty>No aircraft found.</CommandEmpty>
            ) : (
              filtered.map((cat) => (
                <CommandGroup key={cat.label} heading={cat.label}>
                  {cat.types.map((type) => (
                    <CommandItem
                      key={type}
                      value={type}
                      onSelect={() => handleSelect(type)}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4 shrink-0",
                          value === type ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {type}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
