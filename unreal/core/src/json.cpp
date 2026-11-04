#include "at3d/json.hpp"

#include <cstdlib>
#include <fstream>
#include <sstream>

namespace at3d::json {

namespace {
const Value kNull{};

struct Parser {
  const std::string& s;
  size_t i = 0;

  explicit Parser(const std::string& text) : s(text) {}

  [[noreturn]] void fail(const char* what) const { throw Error(std::string("json: ") + what + " at byte " + std::to_string(i)); }
  void ws() {
    while (i < s.size() && (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t')) i++;
  }
  bool eat(char c) {
    ws();
    if (i < s.size() && s[i] == c) {
      i++;
      return true;
    }
    return false;
  }
  void expect(char c) {
    if (!eat(c)) fail("unexpected character");
  }
  bool lit(const char* w) {
    size_t n = 0;
    while (w[n]) n++;
    if (s.compare(i, n, w) == 0) {
      i += n;
      return true;
    }
    return false;
  }

  static void utf8(std::string& out, uint32_t cp) {
    if (cp < 0x80) out += static_cast<char>(cp);
    else if (cp < 0x800) {
      out += static_cast<char>(0xC0 | (cp >> 6));
      out += static_cast<char>(0x80 | (cp & 0x3F));
    } else if (cp < 0x10000) {
      out += static_cast<char>(0xE0 | (cp >> 12));
      out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
      out += static_cast<char>(0x80 | (cp & 0x3F));
    } else {
      out += static_cast<char>(0xF0 | (cp >> 18));
      out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
      out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
      out += static_cast<char>(0x80 | (cp & 0x3F));
    }
  }
  uint32_t hex4() {
    if (i + 4 > s.size()) fail("short \\u escape");
    uint32_t v = 0;
    for (int k = 0; k < 4; k++) {
      char c = s[i++];
      v <<= 4;
      if (c >= '0' && c <= '9') v |= static_cast<uint32_t>(c - '0');
      else if (c >= 'a' && c <= 'f') v |= static_cast<uint32_t>(c - 'a' + 10);
      else if (c >= 'A' && c <= 'F') v |= static_cast<uint32_t>(c - 'A' + 10);
      else fail("bad \\u escape");
    }
    return v;
  }

  std::string string() {
    expect('"');
    std::string out;
    while (true) {
      if (i >= s.size()) fail("unterminated string");
      char c = s[i++];
      if (c == '"') return out;
      if (c != '\\') {
        out += c;
        continue;
      }
      if (i >= s.size()) fail("unterminated escape");
      char e = s[i++];
      switch (e) {
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        case '/': out += '/'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'u': {
          uint32_t cp = hex4();
          if (cp >= 0xD800 && cp < 0xDC00 && s.compare(i, 2, "\\u") == 0) {
            i += 2;
            uint32_t lo = hex4();
            cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
          }
          utf8(out, cp);
          break;
        }
        default: fail("bad escape");
      }
    }
  }

  Value value() {
    ws();
    if (i >= s.size()) fail("unexpected end");
    Value v;
    char c = s[i];
    if (c == '{') {
      i++;
      v.type = Value::Type::Object;
      if (eat('}')) return v;
      do {
        ws();
        std::string k = string();
        expect(':');
        v.members.emplace_back(std::move(k), value());
      } while (eat(','));
      expect('}');
    } else if (c == '[') {
      i++;
      v.type = Value::Type::Array;
      if (eat(']')) return v;
      do {
        v.items.push_back(value());
      } while (eat(','));
      expect(']');
    } else if (c == '"') {
      v.type = Value::Type::String;
      v.string = string();
    } else if (lit("true")) {
      v.type = Value::Type::Bool;
      v.boolean = true;
    } else if (lit("false")) {
      v.type = Value::Type::Bool;
    } else if (lit("null")) {
      v.type = Value::Type::Null;
    } else {
      const char* begin = s.c_str() + i;
      char* end = nullptr;
      double d = std::strtod(begin, &end);
      if (end == begin) fail("unexpected character");
      i += static_cast<size_t>(end - begin);
      v.type = Value::Type::Number;
      v.number = d;
    }
    return v;
  }
};
}  // namespace

const Value& Value::at(size_t idx) const { return type == Type::Array && idx < items.size() ? items[idx] : kNull; }

const Value& Value::operator[](const std::string& key) const {
  if (type == Type::Object)
    for (const auto& m : members)
      if (m.first == key) return m.second;
  return kNull;
}

bool Value::has(const std::string& key) const {
  if (type == Type::Object)
    for (const auto& m : members)
      if (m.first == key) return true;
  return false;
}

Value parse(const std::string& text) {
  Parser p(text);
  Value v = p.value();
  p.ws();
  if (p.i != text.size()) p.fail("trailing characters");
  return v;
}

Value parseFile(const std::string& path) {
  std::ifstream f(path, std::ios::binary);
  if (!f) throw Error("json: cannot read " + path);
  std::ostringstream ss;
  ss << f.rdbuf();
  return parse(ss.str());
}

}  // namespace at3d::json
