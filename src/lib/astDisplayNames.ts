/**
 * Human-readable display names for Tree-sitter CST node types.
 * These replace the technical grammar names (like "package_clause")
 * with friendlier labels (like "Package Declaration") in the AST visualizer.
 *
 * Organized by language, with a fallback to common names shared across languages.
 */

// Common display names that apply across multiple languages
const COMMON_DISPLAY_NAMES: Record<string, string> = {
    // Root / Module
    source_file: "Source File",
    module: "Module",
    program: "Program",

    // Comments
    comment: "Comment",
    line_comment: "Line Comment",
    block_comment: "Block Comment",

    // Identifiers
    identifier: "Identifier",
    type_identifier: "Type Name",
    field_identifier: "Field Name",

    // Literals
    string: "String",
    string_literal: "String Literal",
    interpreted_string_literal: "String",
    raw_string_literal: "Raw String",
    integer: "Integer",
    integer_literal: "Integer",
    int_literal: "Integer",
    float: "Float",
    float_literal: "Float",
    true: "True",
    false: "False",
    nil: "Nil",
    none: "None",
    null: "Null",

    // Operators
    binary_expression: "Binary Expression",
    unary_expression: "Unary Expression",
    comparison_operator: "Comparison",

    // Common structures
    block: "Block",
    body: "Body",
    parenthesized_expression: "Parenthesized Expression",
    argument_list: "Arguments",
    parameter_list: "Parameters",
    parameters: "Parameters",

    // Expressions
    call_expression: "Function Call",
    call: "Function Call",
    selector_expression: "Member Access",
    index_expression: "Index Access",
    subscript: "Subscript",
    slice_expression: "Slice",

    // Assignments
    assignment: "Assignment",
    assignment_statement: "Assignment",
    assignment_expression: "Assignment",
    augmented_assignment: "Compound Assignment",

    // Control flow
    if_statement: "If Statement",
    else_clause: "Else Clause",
    for_statement: "For Loop",
    while_statement: "While Loop",
    return_statement: "Return Statement",
    break_statement: "Break",
    continue_statement: "Continue",

    // Try/Catch
    try_statement: "Try Statement",
    catch_clause: "Catch Clause",
    finally_clause: "Finally Clause",

    // Lists & collections
    list: "List",
    array: "Array",
    dictionary: "Dictionary",
    map_type: "Map Type",
    slice_type: "Slice Type",
    array_type: "Array Type",

    // Expressions
    expression_statement: "Expression Statement",
    expression_list: "Expressions",
};

// Go-specific display names
const GO_DISPLAY_NAMES: Record<string, string> = {
    // Package & imports
    package_clause: "Package Declaration",
    package_identifier: "Package Name",
    import_declaration: "Import",
    import_spec: "Import Spec",
    import_spec_list: "Import List",
    dot: "Dot Import",
    blank_identifier: "Blank Identifier",

    // Declarations
    function_declaration: "Function",
    method_declaration: "Method",
    type_declaration: "Type Declaration",
    type_spec: "Type Definition",
    const_declaration: "Constants",
    const_spec: "Constant",
    var_declaration: "Variables",
    var_spec: "Variable",
    short_var_declaration: "Short Variable Declaration",

    // Types
    struct_type: "Struct",
    interface_type: "Interface",
    field_declaration: "Field",
    field_declaration_list: "Fields",
    method_spec: "Method Signature",
    method_spec_list: "Method Signatures",
    pointer_type: "Pointer Type",
    channel_type: "Channel Type",
    function_type: "Function Type",
    qualified_type: "Qualified Type",
    generic_type: "Generic Type",
    type_arguments: "Type Arguments",
    type_parameters: "Type Parameters",
    type_parameter_declaration: "Type Parameter",
    type_constraint: "Type Constraint",

    // Function parts
    parameter_declaration: "Parameter",
    variadic_parameter_declaration: "Variadic Parameter",
    result: "Return Type",

    // Expressions
    composite_literal: "Composite Literal",
    literal_value: "Literal Value",
    literal_element: "Element",
    keyed_element: "Keyed Element",
    func_literal: "Anonymous Function",
    type_assertion: "Type Assertion",
    type_conversion: "Type Conversion",

    // Statements
    go_statement: "Go Statement",
    defer_statement: "Defer Statement",
    send_statement: "Channel Send",
    receive_statement: "Channel Receive",
    inc_statement: "Increment",
    dec_statement: "Decrement",
    labeled_statement: "Labeled Statement",
    empty_statement: "Empty Statement",
    fallthrough_statement: "Fallthrough",
    goto_statement: "Goto",

    // Control flow
    for_clause: "For Clause",
    range_clause: "Range Clause",
    expression_switch_statement: "Switch Statement",
    type_switch_statement: "Type Switch",
    expression_case: "Case",
    type_case: "Type Case",
    default_case: "Default Case",
    select_statement: "Select Statement",
    communication_case: "Communication Case",
    if_statement: "If Statement",
    else_clause: "Else",
    // Other
    iota: "Iota",
};

// Python-specific display names
const PYTHON_DISPLAY_NAMES: Record<string, string> = {
    // Module level
    module: "Module",
    expression_statement: "Expression",

    // Imports
    import_statement: "Import",
    import_from_statement: "From Import",
    aliased_import: "Aliased Import",
    dotted_name: "Module Path",
    relative_import: "Relative Import",
    wildcard_import: "Wildcard Import",

    // Definitions
    function_definition: "Function Definition",
    async_function_definition: "Async Function",
    class_definition: "Class Definition",
    decorated_definition: "Decorated Definition",
    decorator: "Decorator",
    lambda: "Lambda",

    // Parameters
    parameters: "Parameters",
    typed_parameter: "Typed Parameter",
    default_parameter: "Default Parameter",
    typed_default_parameter: "Typed Default Parameter",
    list_splat_pattern: "Args (*)",
    dictionary_splat_pattern: "Kwargs (**)",
    keyword_separator: "Keyword-only Separator",
    positional_separator: "Positional-only Separator",

    // Arguments
    argument_list: "Arguments",
    keyword_argument: "Keyword Argument",
    list_splat: "Splat Argument (*)",
    dictionary_splat: "Kwargs Argument (**)",

    // Control flow
    if_statement: "If Statement",
    elif_clause: "Elif Clause",
    else_clause: "Else Clause",
    for_statement: "For Loop",
    while_statement: "While Loop",
    with_statement: "With Statement",
    with_clause: "With Clause",
    with_item: "Context Manager",
    match_statement: "Match Statement",
    match_stmt: "Match Statement",
    case_clause: "Case Clause",
    case_block: "Case Block",

    // Exception handling
    try_statement: "Try Statement",
    except_clause: "Except Clause",
    except_group_clause: "Except Group",
    finally_clause: "Finally Clause",
    raise_statement: "Raise Statement",

    // Statements
    return_statement: "Return",
    yield_statement: "Yield",
    pass_statement: "Pass",
    break_statement: "Break",
    continue_statement: "Continue",
    global_statement: "Global",
    nonlocal_statement: "Nonlocal",
    assert_statement: "Assert",
    delete_statement: "Delete",
    exec_statement: "Exec",
    print_statement: "Print",

    // Expressions
    assignment: "Assignment",
    augmented_assignment: "Compound Assignment",
    named_expression: "Walrus Operator",
    conditional_expression: "Ternary Expression",
    boolean_operator: "Boolean Operator",
    not_operator: "Not Operator",
    comparison_operator: "Comparison",
    await_expression: "Await",

    // Comprehensions
    list_comprehension: "List Comprehension",
    dictionary_comprehension: "Dict Comprehension",
    set_comprehension: "Set Comprehension",
    generator_expression: "Generator Expression",
    for_in_clause: "For Clause",
    if_clause: "If Clause",

    // Data structures
    list: "List",
    tuple: "Tuple",
    dictionary: "Dictionary",
    set: "Set",
    pair: "Key-Value Pair",

    // Literals
    string: "String",
    concatenated_string: "Concatenated String",
    interpolation: "F-string Interpolation",
    format_specifier: "Format Specifier",
    escape_sequence: "Escape Sequence",
    integer: "Integer",
    float: "Float",
    true: "True",
    false: "False",
    none: "None",
    ellipsis: "Ellipsis",

    // Types (type hints)
    type: "Type Annotation",
    generic_type: "Generic Type",
    union_type: "Union Type",
    constrained_type: "Constrained Type",
    member_type: "Member Type",

    // Classes
    class_body: "Class Body",
    class_heritage: "Inheritance",

    // Other
    block: "Block",
    expression_list: "Expressions",
    pattern_list: "Patterns",
    parenthesized_expression: "Parenthesized",
    attribute: "Attribute Access",
    subscript: "Subscript",
    slice: "Slice",
    call: "Function Call",
    binary_operator: "Binary Operator",
    unary_operator: "Unary Operator",
};

// JavaScript/TypeScript-specific display names
const JS_DISPLAY_NAMES: Record<string, string> = {
    // Imports/Exports
    import_statement: "Import",
    export_statement: "Export",
    import_clause: "Import Clause",
    named_imports: "Named Imports",
    import_specifier: "Import Specifier",
    namespace_import: "Namespace Import",

    // Declarations
    lexical_declaration: "Variable Declaration",
    variable_declaration: "Variable Declaration",
    variable_declarator: "Variable",
    function_declaration: "Function",
    generator_function_declaration: "Generator Function",
    class_declaration: "Class",
    method_definition: "Method",
    field_definition: "Field",
    public_field_definition: "Public Field",
    class_static_block: "Static Block",

    // Functions
    arrow_function: "Arrow Function",
    function_expression: "Function Expression",
    generator_function: "Generator Function",
    formal_parameters: "Parameters",
    rest_pattern: "Rest Parameter",
    spread_element: "Spread",

    // Classes
    class_body: "Class Body",
    class_heritage: "Extends",
    static_block: "Static Block",

    // Control flow
    if_statement: "If Statement",
    else_clause: "Else",
    for_statement: "For Loop",
    for_in_statement: "For-In Loop",
    while_statement: "While Loop",
    do_statement: "Do-While Loop",
    switch_statement: "Switch Statement",
    switch_case: "Case",
    switch_default: "Default Case",
    switch_body: "Switch Body",

    // Exception handling
    try_statement: "Try Statement",
    catch_clause: "Catch",
    finally_clause: "Finally",
    throw_statement: "Throw",

    // Statements
    return_statement: "Return",
    break_statement: "Break",
    continue_statement: "Continue",
    debugger_statement: "Debugger",
    with_statement: "With Statement",
    labeled_statement: "Labeled Statement",
    expression_statement: "Expression",

    // Expressions
    new_expression: "New Expression",
    await_expression: "Await",
    yield_expression: "Yield",
    ternary_expression: "Ternary",
    binary_expression: "Binary Expression",
    unary_expression: "Unary Expression",
    update_expression: "Update Expression",
    member_expression: "Member Access",
    subscript_expression: "Index Access",
    call_expression: "Function Call",
    template_string: "Template String",
    template_substitution: "Template Substitution",

    // Literals & objects
    object: "Object",
    array: "Array",
    pair: "Property",
    shorthand_property_identifier: "Property Shorthand",
    computed_property_name: "Computed Property",
    string: "String",
    number: "Number",
    regex: "Regex",

    // Async
    async_function: "Async Function",
    async_arrow_function: "Async Arrow Function",
};

// Ruby-specific display names
const RUBY_DISPLAY_NAMES: Record<string, string> = {
    // Classes & modules
    class: "Class",
    module: "Module",
    singleton_class: "Singleton Class",
    superclass: "Superclass",

    // Methods
    method: "Method",
    method_definition: "Method",
    singleton_method: "Singleton Method",
    singleton_method_definition: "Singleton Method",
    method_parameters: "Parameters",

    // Blocks
    block: "Block",
    do_block: "Do Block",
    brace_block: "Block",
    block_parameters: "Block Parameters",
    lambda: "Lambda",

    // Assignments
    assignment: "Assignment",
    multiple_assignment: "Multiple Assignment",
    operator_assignment: "Operator Assignment",

    // Control flow
    if: "If",
    unless: "Unless",
    elsif: "Elsif",
    if_modifier: "If Modifier",
    unless_modifier: "Unless Modifier",
    case: "Case",
    when: "When",
    when_clause: "When",
    in_clause: "In Pattern",

    // Loops
    while: "While",
    until: "Until",
    for: "For",
    while_modifier: "While Modifier",
    until_modifier: "Until Modifier",

    // Exception handling
    begin: "Begin",
    rescue: "Rescue",
    rescue_clause: "Rescue",
    ensure: "Ensure",
    raise: "Raise",

    // Statements
    return: "Return",
    break: "Break",
    next: "Next",
    redo: "Redo",
    retry: "Retry",
    yield: "Yield",

    // Calls
    call: "Method Call",
    command: "Command",
    command_call: "Command Call",
    method_call: "Method Call",

    // Data structures
    hash: "Hash",
    array: "Array",
    pair: "Key-Value Pair",
    range: "Range",
    symbol: "Symbol",
    heredoc_body: "Heredoc",

    // Other
    interpolation: "Interpolation",
    scope_resolution: "Scope Resolution",
    constant: "Constant",
    instance_variable: "Instance Variable",
    class_variable: "Class Variable",
    global_variable: "Global Variable",
};

// Java-specific display names
const JAVA_DISPLAY_NAMES: Record<string, string> = {
    // Package & imports
    package_declaration: "Package",
    import_declaration: "Import",
    import_group: "Imports",
    scoped_identifier: "Qualified Name",

    // Type declarations
    class_declaration: "Class",
    interface_declaration: "Interface",
    enum_declaration: "Enum",
    record_declaration: "Record",
    annotation_type_declaration: "Annotation Type",
    class_body: "Class Body",
    enum_body: "Enum Body",
    interface_body: "Interface Body",

    // Members
    method_declaration: "Method",
    constructor_declaration: "Constructor",
    compact_constructor_declaration: "Compact Constructor",
    field_declaration: "Field",
    local_variable_declaration: "Local Variable",
    static_initializer: "Static Initializer",
    constant_declaration: "Constant",

    // Modifiers
    modifiers: "Modifiers",
    annotation: "Annotation",
    marker_annotation: "Marker Annotation",

    // Parameters
    formal_parameters: "Parameters",
    formal_parameter: "Parameter",
    spread_parameter: "Varargs",
    type_parameters: "Type Parameters",
    type_parameter: "Type Parameter",

    // Control flow
    if_statement: "If Statement",
    for_statement: "For Loop",
    enhanced_for_statement: "Enhanced For Loop",
    while_statement: "While Loop",
    do_statement: "Do-While Loop",
    switch_expression: "Switch",
    switch_block: "Switch Block",
    switch_block_statement_group: "Case Group",
    switch_label: "Case Label",

    // Exception handling
    try_statement: "Try Statement",
    try_with_resources_statement: "Try-With-Resources",
    catch_clause: "Catch",
    finally_clause: "Finally",
    throw_statement: "Throw",
    throws: "Throws",

    // Statements
    return_statement: "Return",
    break_statement: "Break",
    continue_statement: "Continue",
    assert_statement: "Assert",
    synchronized_statement: "Synchronized",
    expression_statement: "Expression",

    // Expressions
    method_invocation: "Method Call",
    object_creation_expression: "New Instance",
    array_creation_expression: "New Array",
    lambda_expression: "Lambda",
    method_reference: "Method Reference",
    ternary_expression: "Ternary",
    cast_expression: "Cast",
    instanceof_expression: "Instanceof",

    // Types
    generic_type: "Generic Type",
    array_type: "Array Type",
    type_arguments: "Type Arguments",
    wildcard: "Wildcard",
    extends_type_clause: "Extends",
    implements_clause: "Implements",

    // Literals
    string_literal: "String",
    character_literal: "Character",
    decimal_integer_literal: "Integer",
    decimal_floating_point_literal: "Float",
};

// C-specific display names
const C_DISPLAY_NAMES: Record<string, string> = {
    // Preprocessor
    preproc_include: "Include",
    preproc_def: "Define",
    preproc_function_def: "Macro",
    preproc_call: "Preprocessor Call",
    preproc_if: "Preprocessor If",
    preproc_ifdef: "Ifdef",
    preproc_else: "Preprocessor Else",
    preproc_elif: "Preprocessor Elif",

    // Declarations
    function_definition: "Function",
    declaration: "Declaration",
    type_definition: "Type Definition",
    parameter_declaration: "Parameter",
    init_declarator: "Declarator",

    // Types
    struct_specifier: "Struct",
    union_specifier: "Union",
    enum_specifier: "Enum",
    field_declaration: "Field",
    field_declaration_list: "Fields",
    enumerator: "Enumerator",
    enumerator_list: "Enumerators",
    pointer_declarator: "Pointer",
    array_declarator: "Array",
    function_declarator: "Function Declarator",

    // Initializers
    initializer_list: "Initializer List",
    initializer_pair: "Designated Initializer",
    field_designator: "Field Designator",
    subscript_designator: "Index Designator",

    // Control flow
    if_statement: "If Statement",
    for_statement: "For Loop",
    while_statement: "While Loop",
    do_statement: "Do-While Loop",
    switch_statement: "Switch Statement",
    case_statement: "Case",
    labeled_statement: "Labeled Statement",

    // Statements
    return_statement: "Return",
    break_statement: "Break",
    continue_statement: "Continue",
    goto_statement: "Goto",
    expression_statement: "Expression",
    compound_statement: "Block",

    // Expressions
    call_expression: "Function Call",
    pointer_expression: "Pointer Expression",
    subscript_expression: "Array Access",
    field_expression: "Member Access",
    cast_expression: "Cast",
    sizeof_expression: "Sizeof",
    conditional_expression: "Ternary",
    assignment_expression: "Assignment",
    update_expression: "Update",
    comma_expression: "Comma Expression",

    // Literals
    string_literal: "String",
    char_literal: "Character",
    number_literal: "Number",
};

// Language to display names map
const LANGUAGE_DISPLAY_NAMES: Record<string, Record<string, string>> = {
    go: GO_DISPLAY_NAMES,
    python: PYTHON_DISPLAY_NAMES,
    javascript: JS_DISPLAY_NAMES,
    typescript: JS_DISPLAY_NAMES, // TypeScript shares JavaScript names
    ruby: RUBY_DISPLAY_NAMES,
    java: JAVA_DISPLAY_NAMES,
    c: C_DISPLAY_NAMES,
};

/**
 * Get a human-readable display name for a Tree-sitter node type.
 * Falls back to the original type if no mapping exists.
 *
 * @param languageId - The language identifier (e.g., "go", "python")
 * @param nodeType - The Tree-sitter node type (e.g., "package_clause")
 * @returns Human-readable display name
 */
export function getNodeDisplayName(
    languageId: string | undefined,
    nodeType: string
): string {
    // First check language-specific names
    if (languageId) {
        const langNames = LANGUAGE_DISPLAY_NAMES[languageId];
        if (langNames?.[nodeType]) {
            return langNames[nodeType];
        }
    }

    // Fall back to common names
    if (COMMON_DISPLAY_NAMES[nodeType]) {
        return COMMON_DISPLAY_NAMES[nodeType];
    }

    // No mapping found, return original type
    return nodeType;
}

/**
 * Check if a display name mapping exists for a node type.
 */
export function hasDisplayName(
    languageId: string | undefined,
    nodeType: string
): boolean {
    if (languageId) {
        const langNames = LANGUAGE_DISPLAY_NAMES[languageId];
        if (langNames?.[nodeType]) {
            return true;
        }
    }
    return !!COMMON_DISPLAY_NAMES[nodeType];
}
