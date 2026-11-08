"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ApplicationChannel } from "./application-draft";

const ApplicationChannelContext = createContext<ApplicationChannel>("portal");

/** The detail route resolves `?origen` on the server and hands the channel to its apply link. */
export function ApplicationChannelProvider({ channel, children }: { channel: ApplicationChannel; children: ReactNode }) {
  return <ApplicationChannelContext.Provider value={channel}>{children}</ApplicationChannelContext.Provider>;
}

/** Without a provider the apply link stays on the portal route. */
export function useApplicationChannel(): ApplicationChannel {
  return useContext(ApplicationChannelContext);
}
