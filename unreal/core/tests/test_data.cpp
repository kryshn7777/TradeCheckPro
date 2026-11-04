// Checks the C++ reader against what the web build exported: the level counts, the constants and the golden traces' shape.
#include <cmath>
#include <cstdio>
#include <string>

#include "at3d/json.hpp"

using at3d::json::Value;
static int fails = 0;
#define CHECK(c, msg)                                   \
  do {                                                  \
    if (c) std::printf("PASS %s\n", msg);               \
    else {                                              \
      std::printf("FAIL %s\n", msg);                    \
      fails++;                                          \
    }                                                   \
  } while (0)

int main() {
  const std::string root = AT3D_ROOT;
  Value summary = at3d::json::parseFile(root + "/data/summary.json");
  Value level = at3d::json::parseFile(root + "/data/level-ch1.json");
  Value config = at3d::json::parseFile(root + "/data/config.json");
  Value diff = at3d::json::parseFile(root + "/data/difficulty.json");

  bool counts = summary["counts"].size() > 0;
  for (const auto& m : summary["counts"].members) counts = counts && static_cast<size_t>(m.second.num(-1)) == level[m.first].size();
  CHECK(counts, "every level array has the exported length (solids, anchors, decor, ...)");
  CHECK(level["solids"].size() == 175 && level["anchors"].size() == 81 && level["sections"].size() == 8, "Chapter I: 175 solids, 81 anchors, 8 sections");
  CHECK(std::fabs(config["PHYSICS_DT"].num() - summary["physicsDt"].num()) == 0.0, "PHYSICS_DT is read exactly");
  CHECK(std::fabs(config["player"]["gravity"].num() - summary["gravity"].num()) == 0.0 && summary["gravity"].num() > 0, "gravity is read exactly");
  CHECK(config["player"]["runMaxSpeed"].num() == summary["runMaxSpeed"].num(), "runMaxSpeed is read exactly");
  CHECK(diff.size() == 4 && diff.has("normal") && diff["nightmare"]["darkness"].num() > 0.7, "four difficulties, Nightmare darkness 0.72");
  CHECK(level["spawn"]["x"].isNumber() && level["solids"].at(0)["maxY"].num() == 60 && level["solids"].at(0)["kind"].str() == "wall", "numbers inside nested arrays and objects");
  CHECK(level["boards"].at(0)["text"].isString() || level["decor"].at(0)["type"].isString(), "strings are read");
  CHECK(level["no-such-key"]["still"]["safe"].isNull(), "a missing key chain is a safe null");

  Value gold = at3d::json::parseFile(root + "/golden/physics-basic.json");
  bool rows = gold["scenarios"].size() >= 5;
  for (const auto& sc : gold["scenarios"].items) rows = rows && sc["rows"].size() == static_cast<size_t>(sc["steps"].num()) && sc["rows"].at(0).size() == 7;
  CHECK(rows, "the golden traces: every scenario has one 7-value row per step");

  try {
    at3d::json::parse("{\"a\": [1, 2,]}");
    CHECK(false, "malformed JSON is rejected");
  } catch (const at3d::json::Error&) {
    CHECK(true, "malformed JSON is rejected");
  }
  Value esc = at3d::json::parse("{\"s\": \"a\\\"b\\n\\u00e9\\ud83d\\ude00\", \"n\": -1.5e2, \"t\": true}");
  CHECK(esc["s"].str() == std::string("a\"b\n\xC3\xA9\xF0\x9F\x98\x80") && esc["n"].num() == -150 && esc["t"].flag(), "escapes, surrogate pairs, exponents, booleans");

  std::printf(fails ? "%d FAILED\n" : "ALL PASSED\n", fails);
  return fails ? 1 : 0;
}
