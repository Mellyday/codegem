# Decorator Behavior Examples

This file documents what "pieces" are questioned based on the `pyEngine.ts` logic for various decorated Python constructs.

---

## Decorated Class with Multiple Bases and Metaclass

```python
@decorator_one
@decorator_two(arg)
class MyClass(BaseClass1, BaseClass2, metaclass=SomeMeta):
    """Docstring"""
    pass
```

### Expected Questions (from `decorated_definition` + `class_definition` rules):

**Decorator Questions (`decorated_definition` rule):**
- **Which decorators are applied?** → Multi-select: `decorator_one`, `decorator_two`
  - _Extracts decorator names (without @, without args)_
- **What is argument #1 of @decorator_two?** → Single-select: `arg`
  - _For decorators with positional arguments_

**Class Questions (`class_definition` rule):**
- **Which are base classes of this class?** → Multi-select: `BaseClass1`, `BaseClass2`
  - _Extracts from "bases" section_
- **What is the metaclass of this class?** → Single-select: `SomeMeta`
  - _Extracts from keywords where key === "metaclass"_

---

## Multiple Stacked Decorators on Function

```python
@app.route("/api")
@login_required
@cache(timeout=300)
def my_function():
    pass
```

### Expected Questions (from `decorated_definition` + `function_definition` rules):

**Decorator Questions (`decorated_definition` rule):**
- **Which decorators are applied?** → Multi-select: `app.route`, `login_required`, `cache`
  - _Extracts decorator names including dotted_name/attribute access_
- **What is argument #1 of @app.route?** → Single-select: `"/api"`
  - _Positional arg for decorator with parentheses_
- **What is the value of timeout= in @cache?** → Single-select: `300`
  - _Keyword arg extraction from decorator_

**Function Questions (`function_definition` rule):**
- _(No params, no return type, no body content → no function-specific questions)_

---

## Class with Methods (init, classmethod, staticmethod)

```python
class MyClass:
    def __init__(self, name: str, age: int = 0) -> None:
        self.name = name
    
    @classmethod
    def from_dict(cls, data: dict) -> "MyClass":
        pass
    
    @staticmethod
    def helper() -> bool:
        pass
```

### Expected Questions:

**For `class MyClass:`** (`class_definition` rule):
- _(No bases, no metaclass, no type params → no class-specific questions)_

**For `def __init__(self, name: str, age: int = 0) -> None:`** (`function_definition` rule):
- **Which of the following are parameters of this function?** → Multi-select: `self`, `name`, `age`
  - _Extracts from "args" section_
- **What is the default value of parameter age?** → Single-select: `0`
  - _Extracts default values from params with `=`_
- **What is the return type of this function?** → Single-select: `None`
  - _Extracts from "returns" section_

**For `@classmethod def from_dict(cls, data: dict) -> "MyClass":`** (`decorated_definition` + `function_definition` rules):
- **Which decorators are applied?** → Multi-select: `classmethod`
  - _Single decorator, no args_
- **Which of the following are parameters of this function?** → Multi-select: `cls`, `data`
- **What is the return type of this function?** → Single-select: `"MyClass"`

**For `@staticmethod def helper() -> bool:`** (`decorated_definition` + `function_definition` rules):
- **Which decorators are applied?** → Multi-select: `staticmethod`
- **What is the return type of this function?** → Single-select: `bool`
  - _(No params → no param questions)_
