// Test fixture: a check worker that allocates until its heap limit is reached.
const keep = [];
for (;;) keep.push(new Array(1e5).fill(keep.length));
