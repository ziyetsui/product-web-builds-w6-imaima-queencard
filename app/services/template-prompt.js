var GENERIC_SLOT_PATTERN = /\{\{([^{}]+)\}\}/g;

function text(value) {
  return String(value == null ? "" : value).replace(/^\s+|\s+$/g, "");
}

function isFillInPlaceholder(value) {
  return /^\{填写[^}]*\}$/.test(text(value));
}

function addSlot(slots, key, label, value, kind) {
  var normalized = text(value);
  if (!normalized || isFillInPlaceholder(normalized)) return;
  if (slots.some(function (slot) { return slot.key === key; })) return;
  slots.push({
    key: key,
    label: label,
    value: normalized,
    kind: kind,
  });
}

function firstMatch(prompt, patterns) {
  var i = 0;
  var match = null;
  for (i = 0; i < patterns.length; i += 1) {
    match = patterns[i].exec(prompt);
    if (match && match[1]) return text(match[1]);
  }
  return "";
}

function genericSlotsFor(prompt) {
  var slots = [];
  var match = null;
  var index = 0;
  GENERIC_SLOT_PATTERN.lastIndex = 0;
  while ((match = GENERIC_SLOT_PATTERN.exec(prompt))) {
    index += 1;
    slots.push({
      key: "slot-" + index,
      label: text(match[1]) || "填写内容",
      value: "",
      kind: "generic",
    });
  }
  GENERIC_SLOT_PATTERN.lastIndex = 0;
  return slots;
}

function parseTemplatePrompt(prompt) {
  var source = text(prompt);
  var slots = [];
  if (!source) return { slots: [], hasEditableSlots: false };

  addSlot(slots, "category", "主题方向", firstMatch(source, [
    /生成一组新的【([^】]+)】主题/,
    /生成一张新的【([^】]+)】公众号配图/,
    /生成一组新的([^：。\n]+?)主题/,
    /生成一张新的([^：。\n]+?)公众号配图/,
  ]), "category");

  addSlot(slots, "title", "标题", firstMatch(source, [
    /^标题\s*[:：]\s*\n([^\n]+)/m,
    /^标题\s*\n([^\n]+)/m,
    /^标题\s*[:：]\s*([^\n]+)/m,
    /标题《([^》]*)》/,
    /^Title\s*[:：]\s*\n([^\n]+)/m,
    /^Title\s*\n([^\n]+)/m,
    /^Title\s*[:：]\s*([^\n]+)/m,
  ]), "title");

  addSlot(slots, "subtitle", "副标题", firstMatch(source, [
    /^副标题\s*[:：]\s*\n([^\n]+)/m,
    /^副标题\s*\n([^\n]+)/m,
    /^副标题\s*[:：]\s*([^\n]+)/m,
    /副标题“([^”]*)”/,
    /^Subtitle\s*[:：]\s*\n([^\n]+)/m,
    /^Subtitle\s*\n([^\n]+)/m,
    /^Subtitle\s*[:：]\s*([^\n]+)/m,
  ]), "subtitle");

  addSlot(slots, "story-subject", "故事主角", firstMatch(source, [
    /^故事主角\s*[:：]\s*([^\n]+)/m,
  ]), "story-subject");

  addSlot(slots, "topic-product", "主题/商品", firstMatch(source, [
    /^主题\/商品\s*[:：]\s*([^\n]+)/m,
  ]), "topic-product");

  genericSlotsFor(source).forEach(function (slot) {
    slots.push(slot);
  });

  return {
    slots: slots,
    hasEditableSlots: slots.length > 0,
  };
}

function valueFor(values, slot, index) {
  var value = Array.isArray(values) ? values[index] : values && values[slot.key];
  return text(value);
}

function replaceWithValue(source, pattern, value) {
  return source.replace(pattern, function () {
    var args = Array.prototype.slice.call(arguments);
    var whole = args[0];
    var prefix = args[1] || "";
    var groupCount = args.length - 3;
    var suffix = groupCount > 1 ? (args[2] || "") : "";
    if (!whole) return whole;
    return prefix + value + suffix;
  });
}

function replaceCategory(source, value) {
  var result = source;
  if (!value) return result;
  if (/生成一组新的【[^】]+】主题/.test(result)) {
    return replaceWithValue(result, /(生成一组新的【)[^】]+(】主题)/, value);
  }
  if (/生成一张新的【[^】]+】公众号配图/.test(result)) {
    return replaceWithValue(result, /(生成一张新的【)[^】]+(】公众号配图)/, value);
  }
  if (/生成一组新的[^：。\n]+?主题/.test(result)) {
    return replaceWithValue(result, /(生成一组新的)[^：。\n]+?(主题)/, value);
  }
  return replaceWithValue(result, /(生成一张新的)[^：。\n]+?(公众号配图)/, value);
}

function replaceLabeledValue(source, labels, value) {
  var i = 0;
  var result = source;
  var inlinePattern = null;
  var linePattern = null;
  if (!value) return result;

  for (i = 0; i < labels.length; i += 1) {
    inlinePattern = labels[i] === "标题"
      ? /(标题《)[^》]*(》)/
      : labels[i] === "副标题"
        ? /(副标题“)[^”]*(”)/
        : null;
    if (inlinePattern && inlinePattern.test(result)) return replaceWithValue(result, inlinePattern, value);

    linePattern = new RegExp("(^" + labels[i] + "\\s*[:：]\\s*\\n)[^\\n]+", "m");
    if (linePattern.test(result)) return replaceWithValue(result, linePattern, value);
    linePattern = new RegExp("(^" + labels[i] + "\\s*\\n)[^\\n]+", "m");
    if (linePattern.test(result)) return replaceWithValue(result, linePattern, value);
    linePattern = new RegExp("(^" + labels[i] + "\\s*[:：]\\s*)[^\\n]+", "m");
    if (linePattern.test(result)) return replaceWithValue(result, linePattern, value);
  }
  return result;
}

function replaceGenericSlots(source, values, startIndex) {
  var index = startIndex || 0;
  return source.replace(GENERIC_SLOT_PATTERN, function (whole) {
    var key = "slot-" + (index + 1);
    var value = text(Array.isArray(values) ? values[index] : values && values[key]);
    index += 1;
    return value || whole;
  });
}

function renderTemplatePrompt(prompt, values) {
  var source = String(prompt == null ? "" : prompt);
  var parsed = parseTemplatePrompt(source);
  var rendered = source;
  var genericIndex = 0;

  parsed.slots.forEach(function (slot, index) {
    var value = valueFor(values, slot, index);
    if (!value) return;
    if (slot.kind === "category") {
      rendered = replaceCategory(rendered, value);
    } else if (slot.kind === "title") {
      rendered = replaceLabeledValue(rendered, ["标题", "Title"], value);
    } else if (slot.kind === "subtitle") {
      rendered = replaceLabeledValue(rendered, ["副标题", "Subtitle", "简介"], value);
    } else if (slot.kind === "story-subject") {
      rendered = replaceLabeledValue(rendered, ["故事主角"], value);
    } else if (slot.kind === "topic-product") {
      rendered = replaceLabeledValue(rendered, ["主题/商品"], value);
    } else if (slot.kind === "generic") {
      genericIndex += 1;
      rendered = replaceGenericSlots(rendered, values, genericIndex - 1);
    }
  });

  return rendered;
}

module.exports = {
  parseTemplatePrompt: parseTemplatePrompt,
  renderTemplatePrompt: renderTemplatePrompt,
};
