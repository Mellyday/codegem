"""Comprehensive Python Features Showcase

This module demonstrates various modern Python features for testing purposes.
Includes generators, comprehensions, pattern matching, and more.
"""
from __future__ import annotations
from typing import Generator, Iterator, Any, TypeVar, Generic
from dataclasses import dataclass, field
from contextlib import contextmanager
import asyncio

# Type variable for generic classes
T = TypeVar("T")

# Global state for demonstration
_global_counter: int = 0


# =============================================================================
# GENERATOR FUNCTIONS
# =============================================================================

def simple_generator() -> Generator[int, None, None]:
    """Basic generator that yields numbers."""
    yield 1
    yield 2
    yield 3


def fibonacci_generator(n: int) -> Iterator[int]:
    """Fibonacci sequence generator up to n terms."""
    a, b = 0, 1
    for _ in range(n):
        yield a
        a, b = b, a + b


def bidirectional_generator() -> Generator[int, str, str]:
    """Generator that receives values via send()."""
    received = yield 0
    while True:
        if received == "stop":
            return "Generator stopped"
        received = yield len(received) if received else 0


async def async_generator(items: list[str]) -> Generator[str, None, None]:
    """Async generator for streaming data."""
    for item in items:
        await asyncio.sleep(0.1)
        yield f"Processed: {item}"


def delegating_generator() -> Generator[int, None, None]:
    """Generator that delegates to sub-generators with yield from."""
    yield from range(3)
    yield from fibonacci_generator(5)
    yield from simple_generator()


# =============================================================================
# WALRUS OPERATOR (:=)
# =============================================================================

def process_with_walrus(data: list[int]) -> list[int]:
    """Demonstrate walrus operator in various contexts."""
    results = []
    
    # Walrus in while loop
    index = 0
    while (value := data[index] if index < len(data) else None) is not None:
        results.append(value * 2)
        index += 1
    
    # Walrus in if statement
    if (total := sum(data)) > 100:
        print(f"Large total: {total}")
    
    # Walrus in list comprehension filter
    filtered = [y for x in data if (y := x ** 2) > 10]
    
    return results + filtered


def walrus_in_match(value: Any) -> str:
    """Walrus operator combined with pattern matching."""
    match value:
        case str() as s if (length := len(s)) > 5:
            return f"Long string ({length} chars)"
        case int() as n if (doubled := n * 2) > 20:
            return f"Large when doubled: {doubled}"
        case _:
            return "No match"


# =============================================================================
# COMPREHENSIONS (List, Dict, Set, Generator Expression)
# =============================================================================

def all_comprehension_types(numbers: list[int]) -> dict[str, Any]:
    """Demonstrate all types of comprehensions."""
    
    # List comprehension with condition
    list_comp = [x ** 2 for x in numbers if x % 2 == 0]
    
    # Nested list comprehension
    matrix = [[i * j for j in range(1, 4)] for i in range(1, 4)]
    
    # Dict comprehension
    dict_comp = {f"key_{x}": x ** 2 for x in numbers}
    
    # Dict comprehension with condition
    even_dict = {k: v for k, v in dict_comp.items() if v % 2 == 0}
    
    # Set comprehension
    set_comp = {x % 10 for x in numbers}
    
    # Generator expression (lazy evaluation)
    gen_expr = (x ** 3 for x in numbers if x > 0)
    
    # Nested comprehension with multiple iterables
    pairs = [(x, y) for x in range(3) for y in range(3) if x != y]
    
    return {
        "list_comp": list_comp,
        "matrix": matrix,
        "dict_comp": dict_comp,
        "even_dict": even_dict,
        "set_comp": set_comp,
        "gen_expr_sum": sum(gen_expr),
        "pairs": pairs,
    }


# =============================================================================
# F-STRINGS (Formatted String Literals)
# =============================================================================

def fstring_showcase(name: str, value: float, items: list[str]) -> str:
    """Demonstrate various f-string features."""
    
    # Basic f-string
    basic = f"Hello, {name}!"
    
    # F-string with expressions
    expr = f"Value doubled: {value * 2}"
    
    # F-string with format specifiers
    formatted = f"Pi approx: {value:.4f}, Percentage: {value:.1%}"
    
    # F-string with alignment and width
    aligned = f"|{name:>15}|{name:<15}|{name:^15}|"
    
    # F-string with dictionary access
    data = {"x": 10, "y": 20}
    dict_access = f"Coordinates: ({data['x']}, {data['y']})"
    
    # F-string with method calls
    method_call = f"Upper: {name.upper()}, Length: {len(name)}"
    
    # F-string with conditional expression
    conditional = f"Status: {'valid' if value > 0 else 'invalid'}"
    
    # F-string with join and comprehension
    joined = f"Items: {', '.join(item.strip() for item in items)}"
    
    # Debug f-string with =
    debug = f"{name=}, {value=:.2f}"
    
    return "\n".join([basic, expr, formatted, aligned, dict_access, 
                       method_call, conditional, joined, debug])


# =============================================================================
# PATTERN MATCHING (match/case)
# =============================================================================

@dataclass
class Point:
    x: float
    y: float

@dataclass  
class Circle:
    center: Point
    radius: float

@dataclass
class Rectangle:
    top_left: Point
    width: float
    height: float


def pattern_matching_demo(shape: Point | Circle | Rectangle | dict | list) -> str:
    """Comprehensive pattern matching examples."""
    
    match shape:
        # Literal pattern
        case 0:
            return "Zero"
        
        # Capture pattern
        case int(n):
            return f"Integer: {n}"
        
        # Class pattern with attributes
        case Point(x=0, y=0):
            return "Origin point"
        
        case Point(x=x, y=0):
            return f"Point on X-axis at x={x}"
        
        case Point(x=0, y=y):
            return f"Point on Y-axis at y={y}"
        
        case Point(x=x, y=y) if x == y:
            return f"Point on diagonal at ({x}, {y})"
        
        case Point() as p:
            return f"Generic point: ({p.x}, {p.y})"
        
        # Nested class patterns
        case Circle(center=Point(x=0, y=0), radius=r):
            return f"Circle at origin with radius {r}"
        
        case Circle(center=c, radius=r):
            return f"Circle at ({c.x}, {c.y}) with radius {r}"
        
        case Rectangle(top_left=tl, width=w, height=h):
            return f"Rectangle at ({tl.x}, {tl.y}), size {w}x{h}"
        
        # Sequence patterns
        case [first, second]:
            return f"Two-element list: {first}, {second}"
        
        case [first, *middle, last] if len(middle) > 0:
            return f"List with {len(middle) + 2} elements"
        
        case [single]:
            return f"Single element: {single}"
        
        case []:
            return "Empty list"
        
        # Mapping patterns
        case {"type": "user", "name": name, "age": age}:
            return f"User {name}, age {age}"
        
        case {"type": "admin", **rest}:
            return f"Admin with extra fields: {rest}"
        
        case {"error": msg}:
            return f"Error: {msg}"
        
        # OR pattern
        case "yes" | "y" | "true" | "1":
            return "Truthy string"
        
        case "no" | "n" | "false" | "0":
            return "Falsy string"
        
        # Wildcard
        case _:
            return f"Unknown shape type: {type(shape).__name__}"


# =============================================================================
# EXCEPTION HANDLING
# =============================================================================

class CustomError(Exception):
    """Custom exception with additional context."""
    def __init__(self, message: str, code: int = 0):
        super().__init__(message)
        self.code = code


def exception_handling_demo(value: Any) -> str:
    """Demonstrate various exception handling patterns."""
    
    try:
        # Multiple operations that might fail
        if value is None:
            raise ValueError("Value cannot be None")
        
        if isinstance(value, str):
            result = int(value)  # Might raise ValueError
        elif isinstance(value, dict):
            result = value["key"]  # Might raise KeyError
        elif isinstance(value, list):
            result = value[0]  # Might raise IndexError
        else:
            result = value / 2  # Might raise TypeError or ZeroDivisionError
        
        return f"Success: {result}"
    
    except ValueError as e:
        return f"Value error: {e}"
    
    except KeyError as e:
        return f"Missing key: {e}"
    
    except (IndexError, TypeError) as e:
        return f"Access error ({type(e).__name__}): {e}"
    
    except ZeroDivisionError:
        return "Cannot divide by zero"
    
    except Exception as e:
        # Re-raise with additional context
        raise CustomError(f"Unexpected error: {e}", code=500) from e
    
    finally:
        print("Cleanup completed")


def exception_groups_demo(tasks: list) -> list[Any]:
    """Demonstrate exception groups (Python 3.11+)."""
    results = []
    errors = []
    
    for i, task in enumerate(tasks):
        try:
            results.append(task())
        except Exception as e:
            errors.append(e)
    
    if errors:
        raise ExceptionGroup(f"Failed {len(errors)} of {len(tasks)} tasks", errors)
    
    return results


# =============================================================================
# CONTEXT MANAGERS
# =============================================================================

class ResourceManager:
    """Class-based context manager."""
    
    def __init__(self, name: str):
        self.name = name
        self.is_open = False
    
    def __enter__(self) -> "ResourceManager":
        print(f"Opening {self.name}")
        self.is_open = True
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb) -> bool:
        print(f"Closing {self.name}")
        self.is_open = False
        # Return True to suppress exceptions, False to propagate
        if exc_type is ValueError:
            print(f"Suppressed ValueError: {exc_val}")
            return True
        return False
    
    def process(self, data: str) -> str:
        if not self.is_open:
            raise RuntimeError("Resource not open")
        return f"Processed by {self.name}: {data}"


@contextmanager
def timer_context(label: str):
    """Function-based context manager using decorator."""
    import time
    start = time.perf_counter()
    print(f"[{label}] Started")
    try:
        yield start
    except Exception as e:
        print(f"[{label}] Error: {e}")
        raise
    finally:
        elapsed = time.perf_counter() - start
        print(f"[{label}] Elapsed: {elapsed:.4f}s")


async def async_context_demo():
    """Demonstrate async context managers."""
    
    class AsyncResource:
        async def __aenter__(self):
            print("Async enter")
            await asyncio.sleep(0.1)
            return self
        
        async def __aexit__(self, *args):
            print("Async exit")
            await asyncio.sleep(0.1)
        
        async def fetch(self, url: str) -> str:
            await asyncio.sleep(0.1)
            return f"Response from {url}"
    
    async with AsyncResource() as res:
        return await res.fetch("https://example.com")


# =============================================================================
# GLOBAL & NONLOCAL
# =============================================================================

def global_nonlocal_demo() -> tuple[int, callable]:
    """Demonstrate global and nonlocal keywords."""
    global _global_counter
    
    # Modify global variable
    _global_counter += 1
    initial_global = _global_counter
    
    # Enclosing scope variable
    outer_value = 100
    call_count = 0
    
    def inner_function(increment: int) -> int:
        nonlocal outer_value, call_count
        global _global_counter
        
        call_count += 1
        outer_value += increment
        _global_counter += 1
        
        return outer_value
    
    def nested_closure():
        nonlocal call_count
        
        def deeply_nested():
            nonlocal call_count
            call_count += 10
            return call_count
        
        return deeply_nested()
    
    # Call inner function
    inner_function(50)
    inner_function(25)
    
    return (outer_value, inner_function)


def counter_factory(start: int = 0) -> tuple[callable, callable, callable]:
    """Create closure-based counter with nonlocal state."""
    count = start
    
    def increment(by: int = 1) -> int:
        nonlocal count
        count += by
        return count
    
    def decrement(by: int = 1) -> int:
        nonlocal count
        count -= by
        return count
    
    def get() -> int:
        return count
    
    return increment, decrement, get


# =============================================================================
# CLASS ANNOTATIONS & DATACLASSES
# =============================================================================

class AnnotatedClass:
    """Class with various type annotations."""
    
    # Class variable annotations
    class_name: str = "AnnotatedClass"
    instance_count: int = 0
    
    # Instance variable annotations (no default)
    id: int
    name: str
    tags: list[str]
    metadata: dict[str, Any]
    
    def __init__(self, id: int, name: str):
        self.id = id
        self.name = name
        self.tags = []
        self.metadata = {}
        AnnotatedClass.instance_count += 1
    
    def add_tag(self, tag: str) -> "AnnotatedClass":
        """Method with self-referential return type."""
        self.tags.append(tag)
        return self
    
    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AnnotatedClass":
        """Class method with forward reference."""
        return cls(id=data["id"], name=data["name"])
    
    @staticmethod
    def validate_id(id: int) -> bool:
        """Static method with annotations."""
        return id > 0


@dataclass
class GenericDataClass(Generic[T]):
    """Generic dataclass with various field types."""
    
    value: T
    label: str = "default"
    scores: list[float] = field(default_factory=list)
    config: dict[str, Any] = field(default_factory=dict)
    _private: int = field(default=0, repr=False)
    
    def transform(self, func: callable) -> T:
        """Apply transformation to value."""
        return func(self.value)


@dataclass(frozen=True)
class ImmutablePoint:
    """Immutable dataclass."""
    x: float
    y: float
    
    def distance_from_origin(self) -> float:
        return (self.x ** 2 + self.y ** 2) ** 0.5


# Type alias (Python 3.12+ style would use `type` keyword)
ShapeUnion = Point | Circle | Rectangle
Coordinate = tuple[float, float]
Matrix = list[list[float]]


# =============================================================================
# DECORATORS (bonus feature)
# =============================================================================

def retry(max_attempts: int = 3, delay: float = 1.0):
    """Decorator factory for retry logic."""
    def decorator(func: callable) -> callable:
        def wrapper(*args, **kwargs):
            import time
            last_error = None
            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last_error = e
                    if attempt < max_attempts - 1:
                        time.sleep(delay)
            raise last_error
        return wrapper
    return decorator


@retry(max_attempts=3, delay=0.5)
def unreliable_operation() -> str:
    """Operation that might fail."""
    import random
    if random.random() < 0.7:
        raise ConnectionError("Network failure")
    return "Success!"


# =============================================================================
# LAMBDA & HIGHER-ORDER FUNCTIONS (bonus feature)
# =============================================================================

def functional_demo(numbers: list[int]) -> dict[str, Any]:
    """Demonstrate functional programming patterns."""
    
    # Lambda with map
    doubled = list(map(lambda x: x * 2, numbers))
    
    # Lambda with filter
    evens = list(filter(lambda x: x % 2 == 0, numbers))
    
    # Lambda with sorted (key function)
    by_abs = sorted(numbers, key=lambda x: abs(x))
    
    # Lambda with reduce
    from functools import reduce
    product = reduce(lambda a, b: a * b, numbers, 1)
    
    # Nested lambda
    make_adder = lambda n: lambda x: x + n
    add_five = make_adder(5)
    
    return {
        "doubled": doubled,
        "evens": evens,
        "by_abs": by_abs,
        "product": product,
        "add_five_to_10": add_five(10),
    }


# =============================================================================
# MAIN ENTRY POINT
# =============================================================================

if __name__ == "__main__":
    # Test generators
    print("Fibonacci:", list(fibonacci_generator(10)))
    
    # Test walrus operator
    print("Walrus result:", process_with_walrus([1, 2, 3, 4, 5, 10, 20]))
    
    # Test comprehensions
    print("Comprehensions:", all_comprehension_types([1, 2, 3, 4, 5]))
    
    # Test f-strings
    print(fstring_showcase("Alice", 3.14159, ["  one  ", "two", " three "]))
    
    # Test pattern matching
    shapes = [
        Point(0, 0),
        Point(5, 0),
        Circle(Point(0, 0), 10),
        {"type": "user", "name": "Bob", "age": 30},
        [1, 2, 3],
    ]
    for shape in shapes:
        print(f"Pattern match: {pattern_matching_demo(shape)}")
    
    # Test exception handling
    for val in ["42", {"key": "value"}, [1, 2, 3], 10, None]:
        try:
            print(f"Exception test: {exception_handling_demo(val)}")
        except CustomError as e:
            print(f"Custom error: {e} (code={e.code})")
    
    # Test context managers
    with ResourceManager("TestResource") as rm:
        print(rm.process("test data"))
    
    with timer_context("Computation"):
        result = sum(range(1000000))
        print(f"Result: {result}")
    
    # Test global/nonlocal
    value, func = global_nonlocal_demo()
    print(f"Outer value after calls: {value}")
    print(f"Global counter: {_global_counter}")
    
    # Test class annotations
    obj = AnnotatedClass(1, "test")
    obj.add_tag("python").add_tag("testing")
    print(f"Annotated: {obj.name}, tags={obj.tags}")
    
    # Test dataclasses
    data = GenericDataClass(value=42, label="answer")
    print(f"Generic dataclass: {data}")
    print(f"Transformed: {data.transform(lambda x: x * 2)}")
