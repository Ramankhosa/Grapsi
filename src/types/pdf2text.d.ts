declare module 'pdf2text' {
  interface Pdf2TextResult {
    pages: string[];
    text: string;
  }

  function pdf2text(buffer: Buffer): Promise<string | string[]>;

  export = {
    pdf2text: pdf2text
  };
}
