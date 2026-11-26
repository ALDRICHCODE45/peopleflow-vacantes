"use client";
import { createContext, useContext } from "react";
import {
  getCandidateFacetsAction, getCandidateUnreadCountAction, getFacetsAction, getUnreadCountAction, listCandidateNotificationsAction,
  listNotificationsAction, markAllCandidateReadAction, markAllReadAction, markCandidateReadAction, markCandidateUnreadAction,
  markReadAction, markUnreadAction,
} from "../actions";
import type { NotificationScope } from "../model";

/** Which inbox the bell, sheet and hooks below it read and write; the company one unless a provider says otherwise. */
export const NotificationScopeContext = createContext<NotificationScope>("company");
export const useNotificationScope = () => useContext(NotificationScopeContext);

export type NotificationActions = {
  list: typeof listNotificationsAction;
  unreadCount: typeof getUnreadCountAction;
  markRead: typeof markReadAction;
  markUnread: typeof markUnreadAction;
  markAllRead: typeof markAllReadAction;
  facets: typeof getFacetsAction;
};

/*
 * Each scope is a fixed set of server actions (see actions.ts); the scope only picks which set to call, it never
 * travels to the server. The bindings are read at call time so a test mock of `../actions` only needs the actions the
 * test exercises.
 */
const COMPANY: NotificationActions = {
  list: input => listNotificationsAction(input),
  unreadCount: () => getUnreadCountAction(),
  markRead: target => markReadAction(target),
  markUnread: target => markUnreadAction(target),
  markAllRead: input => markAllReadAction(input),
  facets: state => getFacetsAction(state),
};
const CANDIDATE: NotificationActions = {
  list: input => listCandidateNotificationsAction(input),
  unreadCount: () => getCandidateUnreadCountAction(),
  markRead: target => markCandidateReadAction(target),
  markUnread: target => markCandidateUnreadAction(target),
  markAllRead: input => markAllCandidateReadAction(input),
  facets: state => getCandidateFacetsAction(state),
};

export const notificationActions = (scope: NotificationScope): NotificationActions => scope === "candidate" ? CANDIDATE : COMPANY;
export const useNotificationActions = () => notificationActions(useNotificationScope());
