// ABYSSAL TETHER core: a minimal JSON reader (objects, arrays, strings, numbers, booleans, null), enough to read the data the web build
// exports (unreal/tools/export-data.mjs). No third-party code, no exceptions across the API except json::Error on malformed input.
#pragma once
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace at3d::json {

struct Error : std::runtime_error {
  using std::runtime_error::runtime_error;
};

class Value {
 public:
  enum class Type { Null, Bool, Number, String, Array, Object };

  Type type = Type::Null;
  bool boolean = false;
  double number = 0;
  std::string string;
  std::vector<Value> items;                            // Array
  std::vector<std::pair<std::string, Value>> members;  // Object, in file order

  bool isNull() const { return type == Type::Null; }
  bool isNumber() const { return type == Type::Number; }
  bool isString() const { return type == Type::String; }
  bool isArray() const { return type == Type::Array; }
  bool isObject() const { return type == Type::Object; }

  /** Array length or object member count (0 for anything else). */
  size_t size() const { return type == Type::Array ? items.size() : type == Type::Object ? members.size() : 0; }
  const Value& at(size_t i) const;
  /** Object member by name; a shared null Value when absent (so chains like v["a"]["b"].num(0) are safe). */
  const Value& operator[](const std::string& key) const;
  bool has(const std::string& key) const;

  double num(double fallback = 0) const { return type == Type::Number ? number : fallback; }
  bool flag(bool fallback = false) const { return type == Type::Bool ? boolean : fallback; }
  const std::string& str() const { return string; }
};

/** Parses a whole JSON document. Throws json::Error with the byte offset on malformed input. */
Value parse(const std::string& text);
/** Reads and parses a file. Throws json::Error when it cannot be read. */
Value parseFile(const std::string& path);

}  // namespace at3d::json
