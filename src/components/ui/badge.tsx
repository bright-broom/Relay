// shadcn/ui registry component, styled with Relay semantic tokens. See docs/COMPONENTS.md.
import * as React from "react";
import { cn } from "@/lib/utils";

function Badge({ className, variant = "default", ...props }: React.ComponentProps<"span"> & {variant?: "default" | "outline"}) {
  return <span data-slot="badge" data-variant={variant} className={cn("pill", className)} {...props} />;
}

export { Badge };
