/**
 * What each role may see and do.
 *
 * The same table is read by the React screens and by the Express API, so hiding
 * a menu item and refusing the matching request are never out of step. Only an
 * administrator handles the property book and the money attached to it; every
 * other role works the site: leads, clients, projects, stock, labour and DPRs.
 */
import type { UserRole } from './constants';

export interface Capabilities {
  /** The Properties module: the unit book, the tower map and bulk import. */
  properties: boolean;
  /** Any price, rate or value carried by a property record. */
  propertyPricing: boolean;
  /** Creating and removing sign-in accounts. */
  manageUsers: boolean;
  /** Configuring the GitHub sync connection. */
  manageSync: boolean;
}

const ADMIN: Capabilities = {
  properties: true,
  propertyPricing: true,
  manageUsers: true,
  manageSync: true,
};

const STAFF: Capabilities = {
  properties: false,
  propertyPricing: false,
  manageUsers: false,
  manageSync: false,
};

export function capabilitiesFor(role: string | null | undefined): Capabilities {
  return role === 'ADMIN' ? ADMIN : STAFF;
}

export function isAdmin(role: string | null | undefined): boolean {
  return role === 'ADMIN';
}

/** Human label for a role, used in the account menu and the users list. */
export function roleLabel(role: string | null | undefined): string {
  switch (role as UserRole) {
    case 'ADMIN':
      return 'Administrator';
    case 'MANAGER':
      return 'Manager';
    case 'ENGINEER':
      return 'Site engineer';
    default:
      return 'User';
  }
}
