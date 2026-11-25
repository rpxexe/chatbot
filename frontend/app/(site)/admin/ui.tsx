import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/** List entry used by the FAQ, document, intent and synonym panels; dimmed when disabled. */
export function ItemCard({ enabled = true, className, ...props }: React.ComponentProps<"div"> & { enabled?: boolean }) {
  return (
    <li>
      <Card size="sm" className={cn("gap-3 px-5 py-4", !enabled && "bg-muted/60 [&_.item-title]:text-subtle", className)} {...props} />
    </li>
  );
}

/** With a label: a labelled switch for forms. Without: a compact list switch that only says "Off" when off. */
export function EnabledSwitch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  if (label) {
    return (
      <Label className="font-normal">
        <Switch checked={checked} onCheckedChange={onChange} />
        {label}
      </Label>
    );
  }
  return (
    <Label className="shrink-0 gap-2 font-normal text-muted-foreground">
      {!checked && <span className="text-xs">Off</span>}
      <Switch checked={checked} onCheckedChange={onChange} aria-label="Enabled" />
    </Label>
  );
}

/** Quiet icon button for row actions. Destructive ones only turn red on hover. */
export function RowAction({ icon: Icon, label, danger, className, ...props }: React.ComponentProps<typeof Button> & { icon: LucideIcon; label: string; danger?: boolean }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      className={cn("text-muted-foreground hover:text-foreground", danger && "hover:bg-destructive/10 hover:text-destructive", className)}
      {...props}
    >
      <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
    </Button>
  );
}

/** Small meta text, e.g. a category or keyword list under an item. */
export const Meta = ({ className, ...props }: React.ComponentProps<"span">) => <span className={cn("text-xs text-muted-foreground", className)} {...props} />;

/** Muted explanation inside a form label. */
export const Hint = ({ children }: { children: React.ReactNode }) => <span className="font-normal text-muted-foreground">{children}</span>;
