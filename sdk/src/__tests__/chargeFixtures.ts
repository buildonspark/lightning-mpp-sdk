/** Locally signed test invoices, valid until 2100; no wallet or funds are used. */
export const invoices = {
  '1': {
    preimage: '0101010101010101010101010101010101010101010101010101010101010101',
    paymentHash: '72cd6e8422c407fb6d098690f1130b7ded7ec2f7f5e1d30bd9d521f015363793',
    encodedInvoice: 'lnbc10n1pnhfpvqpp5wtxkappzcsrlkmgfs6g0zyct0hkhashh7hsaxz7e65slq9fkx7fsdpgf3hkxctvypf5gjeqwfjkwun9wdekjmmwyp6x2um5xq8zx3r5vqcqpfccespp2gk6f7zsdfv8vvha6mmv0fnu2874vdgau3wpcrs6t7sz84jtrnc5pnzdk3ndwl284y0vty965nvnthp24kn95f8kuwup6lmacq88cmzq',
  },
  '100000': {
    preimage: '0202020202020202020202020202020202020202020202020202020202020202',
    paymentHash: '75877bb41d393b5fb8455ce60ecd8dda001d06316496b14dfa7f895656eeca4a',
    encodedInvoice: 'lnbc1m1pnhfpvqpp5wkrhhdqa8ya4lwz9tnnqanvdmgqp6p33vjttzn0607y4v4hwef9qdpgf3hkxctvypf5gjeqwfjkwun9wdekjmmwyp6x2um5xq8zx3r5vqcqpf7ak2vevpfdnsr3h6c0j43e7x7r3guh9ft4n9wzjzuc4kunmwd5njcelap6q8wp85mvg5zqtxa6px0vexxswzt0yqxdl4yprnfrmx4hgqh8k839',
  },
} as const
