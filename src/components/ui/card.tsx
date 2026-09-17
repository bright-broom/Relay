// shadcn/ui registry component, styled with Relay semantic tokens. See docs/COMPONENTS.md.
import * as React from "react";
import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card" className={cn(className)} {...props} />;
}

export {
  Card,
};
