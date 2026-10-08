// Entidade pura `Guardianship` (entities.md): relação tutor<->dependente (N1, BR-MEM-03..08).
export interface Guardianship {
  familyId: string;
  dependentId: string;
  guardianId: string;
  isPrimary: boolean;
  createdAt: Date;
}
