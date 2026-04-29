/** Props for the FacialBiometricsSubform component. */
export interface FacialBiometricsSubformProps {
  initialData?: Record<string, unknown>;
  companyId?: string;
  systemSlug?: string;
  systemToken?: string;
}

/** Props for the OwnerSubform component used by LeadsPage. */
export interface OwnerSubformProps {
  initialData?: Record<string, unknown>;
}
