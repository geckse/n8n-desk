import sanitize from 'sanitize-html'

const allowedTags = [
  'a', 'b', 'blockquote', 'br', 'code', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 'span', 'strong', 'table', 'tbody',
  'td', 'th', 'thead', 'tr', 'ul', 'div', 'sub', 'sup', 'details', 'summary',
  'kbd', 'mark', 'del', 'ins', 'dl', 'dt', 'dd',
]

const allowedAttributes: sanitize.IOptions['allowedAttributes'] = {
  a: ['href', 'target', 'rel', 'title'],
  img: ['src', 'alt', 'width', 'height'],
  code: ['class'],
  span: ['class'],
  div: ['class'],
  pre: ['class'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
}

const defaultOptions: sanitize.IOptions = {
  allowedTags,
  allowedAttributes,
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: sanitize.simpleTransform('a', {
      target: '_blank',
      rel: 'noopener noreferrer',
    }),
  },
}

export function sanitizeHtml(input: string, options?: sanitize.IOptions): string {
  return sanitize(input, options ?? defaultOptions)
}
