"use client";
/**
 * Where dialogs, menus, popovers and tooltips render: a box inside the
 * `.labebal` root instead of <body>, so a stylesheet scoped to `.labebal`
 * (the prebuilt one) styles them too, and nothing leaks into the host page.
 */
import { createContext, useContext } from "react";

const PortalCtx = createContext<HTMLElement | null>(null);

export const PortalContainerProvider = PortalCtx.Provider;

/** The portal box, or undefined (= <body>) until it is mounted. */
export const usePortalContainer = () => useContext(PortalCtx) ?? undefined;
