/**
 * Eine Zelle mit dem, was ihr Format über sie sagt.
 *
 * CSV liefert nur Text; dort muss UniCom erkennen. Eine Tabellenkalkulation
 * oder eine Datenbank weiß dagegen, was in der Zelle steht — diese Auskunft
 * wird mitgenommen, statt sie wegzuwerfen und anschließend zu raten.
 *
 * `EMPTY` heißt: nichts drin. `ERROR` heißt: die Quelle selbst sagt, dass hier
 * kein Wert steht (#NV, #DIV/0!) — das ist etwas anderes als leer und darf
 * nicht als solches durchgehen.
 */
export type DeclaredType = 'STRING' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'EMPTY' | 'ERROR';

export interface Cell {
  text: string;
  declared: DeclaredType;
}

/** Aus reinem Text — der Fall CSV, wo nichts hinterlegt ist. */
export function textCell(text: string): Cell {
  return { text, declared: text.trim() === '' ? 'EMPTY' : 'STRING' };
}
