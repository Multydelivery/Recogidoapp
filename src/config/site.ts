/**
 * Central place for all editable business information.
 * Update these values as the business details change.
 */
export const siteConfig = {
  /** Public-facing brand name shown throughout the site. */
  brandName: "Recogido Dispatch",
  /** Short brand name used in tight spaces (e.g. mobile nav logo). */
  shortName: "Recogido",
  /** Registered legal entity name. Only shown when `isLLCConfirmed` is true. */
  legalName: "Recogido LLC",
  /**
   * Set to `true` once the LLC has been officially approved by the state.
   * While `false`, the site will not display the legal entity name anywhere.
   */
  isLLCConfirmed: false,
  /** Phone number in E.164 format, used for `tel:` links. */
  phone: "+15513890281",
  /** Human-readable phone number for display. */
  phoneDisplay: "+1 (551) 389-0281",
  /** Contact email address, used for `mailto:` links and display. */
  email: "admin@recogidoapp.com",
  /** Domain name without protocol. */
  domain: "recogidoapp.com",
  /** Fully-qualified site URL, used for metadata and structured data. */
  url: "https://recogidoapp.com",
};

export type SiteConfig = typeof siteConfig;
