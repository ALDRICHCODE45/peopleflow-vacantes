/** Spanish count agreement: singular for exactly one, plural otherwise. */
export const plural = (count: number, singular: string, pluralForm: string) =>
  `${count} ${count === 1 ? singular : pluralForm}`;
