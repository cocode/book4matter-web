-- Resolve uploaded images without imposing a media/ directory. This filter
-- runs before the book's filters, so wrapped images receive the same paths.
local files = pandoc.json.decode(os.getenv('BF_WEB_FILES') or '[]')
local dirs = pandoc.json.decode(os.getenv('BF_WEB_CHAPTER_DIRS') or '[]')
local root = os.getenv('BF_WEB_ROOT') or '/book/project'
local available = {}
for _, path in ipairs(files) do available[path] = true end

local function normalize(path)
  local parts = {}
  for part in path:gmatch('[^/]+') do
    if part == '..' then table.remove(parts)
    elseif part ~= '.' then table.insert(parts, part) end
  end
  return '/' .. table.concat(parts, '/')
end

function Image(image)
  if image.src:match('^data:') then return image end
  if image.src:match('^%a[%w+.-]*:') or image.src:match('^//') then
    error('Add the image as a local file before building: ' .. image.src)
  end
  local src = image.src:gsub('%%(%x%x)', function(hex) return string.char(tonumber(hex, 16)) end)
  local matches = {}
  local function consider(path)
    path = normalize(path)
    if available[path] then matches[path] = true end
  end
  consider(root .. '/' .. src)
  for _, directory in ipairs(dirs) do consider(directory .. '/' .. src) end
  local function count()
    local n, found = 0, nil
    for path in pairs(matches) do n = n + 1; found = path end
    return n, found
  end
  local n, found = count()
  if n == 0 then
    local basename = src:match('[^/]+$')
    for _, path in ipairs(files) do
      if path:match('[^/]+$') == basename then matches[path] = true end
    end
    n, found = count()
  end
  if n ~= 1 then error('Cannot find a unique uploaded image for: ' .. image.src) end
  -- Typst resolves root-absolute paths relative to --root. Pandoc's HTML/EPUB
  -- writers read the image from the WASI filesystem instead.
  image.src = FORMAT == 'typst' and found:sub(#root + 1) or found
  return image
end
