declare module 'plantuml-encoder' {
  const plantumlEncoder: {
    encode: (text: string) => string
    decode: (encoded: string) => string
  }
  export default plantumlEncoder
}

