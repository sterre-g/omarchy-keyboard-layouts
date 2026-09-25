local chunk, expected, broken = arg[1], arg[2], arg[3]

local seen = {}
hl = { device = function(spec) seen[#seen + 1] = spec.name end }

assert(loadfile(chunk))()
assert(#seen == 1 and seen[1] == expected, "the device name did not reach hl.device intact")
assert(loadfile(broken) == nil, "a control character parsed")
print("ok - a hostile device name reaches hl.device as a string")
