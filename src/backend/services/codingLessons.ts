export interface PythonTestCase {
  id: string;
  description: string;
  setupCode?: string;
  checkExpr: string;
  actualExpr: string;
  expectedDisplay: string;
}

export interface PythonCodingChallenge {
  levelNumber: number;
  title: string;
  lessonGoal: string;
  starterCode: string;
  hintsSummary: string;
  testCases: PythonTestCase[];
}

const EXACT_CHALLENGES: Record<number, PythonCodingChallenge> = {
  1: {
    levelNumber: 1,
    title: 'Variables & Assignment',
    lessonGoal:
      'Create two variables: set score to the integer 42 and language to the string "Python".',
    starterCode: '# Assign the two variables below\nscore = 0\nlanguage = ""\n',
    hintsSummary: 'Use = to bind an integer to score and a quoted string to language.',
    testCases: [
      {
        id: 't1',
        description: 'score equals integer 42',
        checkExpr: "ns.get('score') == 42 and type(ns.get('score')) is int",
        actualExpr: "repr(ns.get('score'))",
        expectedDisplay: '42',
      },
      {
        id: 't2',
        description: 'language equals "Python"',
        checkExpr: "ns.get('language') == 'Python' and isinstance(ns.get('language'), str)",
        actualExpr: "repr(ns.get('language'))",
        expectedDisplay: "'Python'",
      },
    ],
  },
  2: {
    levelNumber: 2,
    title: 'Numbers & Arithmetic',
    lessonGoal:
      'Write a function calculate_total(price, qty) that returns price * qty, and a function remainder_of(a, b) that returns a % b.',
    starterCode:
      'def calculate_total(price, qty):\n    # return the product\n    pass\n\ndef remainder_of(a, b):\n    # return the remainder\n    pass\n',
    hintsSummary: 'Use * for multiplication and % for modulo inside return statements.',
    testCases: [
      {
        id: 't1',
        description: 'calculate_total(12, 3) returns 36',
        checkExpr: "callable(ns.get('calculate_total')) and ns['calculate_total'](12, 3) == 36",
        actualExpr: "repr(ns['calculate_total'](12, 3)) if callable(ns.get('calculate_total')) else 'missing function'",
        expectedDisplay: '36',
      },
      {
        id: 't2',
        description: 'calculate_total(5, 0) returns 0',
        checkExpr: "callable(ns.get('calculate_total')) and ns['calculate_total'](5, 0) == 0",
        actualExpr: "repr(ns['calculate_total'](5, 0)) if callable(ns.get('calculate_total')) else 'missing function'",
        expectedDisplay: '0',
      },
      {
        id: 't3',
        description: 'remainder_of(17, 5) returns 2',
        checkExpr: "callable(ns.get('remainder_of')) and ns['remainder_of'](17, 5) == 2",
        actualExpr: "repr(ns['remainder_of'](17, 5)) if callable(ns.get('remainder_of')) else 'missing function'",
        expectedDisplay: '2',
      },
    ],
  },
  3: {
    levelNumber: 3,
    title: 'Strings & Indexing',
    lessonGoal:
      'Write a function first_three(word) that returns the first 3 characters of word in uppercase.',
    starterCode: 'def first_three(word):\n    # slice and uppercase\n    return ""\n',
    hintsSummary: 'Use string slicing word[:3] combined with .upper().',
    testCases: [
      {
        id: 't1',
        description: 'first_three("python") -> "PYT"',
        checkExpr: "callable(ns.get('first_three')) and ns['first_three']('python') == 'PYT'",
        actualExpr: "repr(ns['first_three']('python')) if callable(ns.get('first_three')) else 'missing function'",
        expectedDisplay: "'PYT'",
      },
      {
        id: 't2',
        description: 'first_three("Code") -> "COD"',
        checkExpr: "callable(ns.get('first_three')) and ns['first_three']('Code') == 'COD'",
        actualExpr: "repr(ns['first_three']('Code')) if callable(ns.get('first_three')) else 'missing function'",
        expectedDisplay: "'COD'",
      },
      {
        id: 't3',
        description: 'first_three("hi") -> "HI"',
        checkExpr: "callable(ns.get('first_three')) and ns['first_three']('hi') == 'HI'",
        actualExpr: "repr(ns['first_three']('hi')) if callable(ns.get('first_three')) else 'missing function'",
        expectedDisplay: "'HI'",
      },
    ],
  },
  4: {
    levelNumber: 4,
    title: 'Booleans & Comparisons',
    lessonGoal:
      'Write a function is_passing(score, has_bonus) that returns True if score >= 70 or (score >= 60 and has_bonus is True), otherwise False.',
    starterCode: 'def is_passing(score, has_bonus):\n    return False\n',
    hintsSummary: 'Combine >= comparisons using boolean operators or and and.',
    testCases: [
      {
        id: 't1',
        description: 'is_passing(75, False) -> True',
        checkExpr: "callable(ns.get('is_passing')) and ns['is_passing'](75, False) is True",
        actualExpr: "repr(ns['is_passing'](75, False)) if callable(ns.get('is_passing')) else 'missing function'",
        expectedDisplay: 'True',
      },
      {
        id: 't2',
        description: 'is_passing(62, True) -> True',
        checkExpr: "callable(ns.get('is_passing')) and ns['is_passing'](62, True) is True",
        actualExpr: "repr(ns['is_passing'](62, True)) if callable(ns.get('is_passing')) else 'missing function'",
        expectedDisplay: 'True',
      },
      {
        id: 't3',
        description: 'is_passing(62, False) -> False',
        checkExpr: "callable(ns.get('is_passing')) and ns['is_passing'](62, False) is False",
        actualExpr: "repr(ns['is_passing'](62, False)) if callable(ns.get('is_passing')) else 'missing function'",
        expectedDisplay: 'False',
      },
    ],
  },
  5: {
    levelNumber: 5,
    title: 'Foundations Sum-Up Challenge',
    lessonGoal:
      'Write a function format_badge(name, points) that returns "<NAME>: <points> pts" with name uppercased.',
    starterCode: 'def format_badge(name, points):\n    return ""\n',
    hintsSummary: 'Use .upper() on name and an f-string like f"{...}: {...} pts".',
    testCases: [
      {
        id: 't1',
        description: 'format_badge("ada", 5) -> "ADA: 5 pts"',
        checkExpr: "callable(ns.get('format_badge')) and ns['format_badge']('ada', 5) == 'ADA: 5 pts'",
        actualExpr: "repr(ns['format_badge']('ada', 5)) if callable(ns.get('format_badge')) else 'missing function'",
        expectedDisplay: "'ADA: 5 pts'",
      },
      {
        id: 't2',
        description: 'format_badge("Nino", 12) -> "NINO: 12 pts"',
        checkExpr: "callable(ns.get('format_badge')) and ns['format_badge']('Nino', 12) == 'NINO: 12 pts'",
        actualExpr: "repr(ns['format_badge']('Nino', 12)) if callable(ns.get('format_badge')) else 'missing function'",
        expectedDisplay: "'NINO: 12 pts'",
      },
    ],
  },
  6: {
    levelNumber: 6,
    title: 'If / Elif Branches',
    lessonGoal:
      'Write a function classify_temp(temp) that returns "cold" if temp < 10, "mild" if 10 <= temp <= 25, and "hot" if temp > 25.',
    starterCode: 'def classify_temp(temp):\n    pass\n',
    hintsSummary: 'Use if, elif, and else to cover all three ranges.',
    testCases: [
      {
        id: 't1',
        description: 'classify_temp(4) -> "cold"',
        checkExpr: "callable(ns.get('classify_temp')) and ns['classify_temp'](4) == 'cold'",
        actualExpr: "repr(ns['classify_temp'](4)) if callable(ns.get('classify_temp')) else 'missing function'",
        expectedDisplay: "'cold'",
      },
      {
        id: 't2',
        description: 'classify_temp(25) -> "mild"',
        checkExpr: "callable(ns.get('classify_temp')) and ns['classify_temp'](25) == 'mild'",
        actualExpr: "repr(ns['classify_temp'](25)) if callable(ns.get('classify_temp')) else 'missing function'",
        expectedDisplay: "'mild'",
      },
      {
        id: 't3',
        description: 'classify_temp(31) -> "hot"',
        checkExpr: "callable(ns.get('classify_temp')) and ns['classify_temp'](31) == 'hot'",
        actualExpr: "repr(ns['classify_temp'](31)) if callable(ns.get('classify_temp')) else 'missing function'",
        expectedDisplay: "'hot'",
      },
    ],
  },
  7: {
    levelNumber: 7,
    title: 'For Loops & Iteration',
    lessonGoal:
      'Write a function sum_even(numbers) that loops over a list of integers and returns the sum of only the even numbers.',
    starterCode: 'def sum_even(numbers):\n    total = 0\n    # loop through numbers\n    return total\n',
    hintsSummary: 'Check if num % 2 == 0 inside a for loop and add to total.',
    testCases: [
      {
        id: 't1',
        description: 'sum_even([1, 2, 3, 4, 6]) -> 12',
        checkExpr: "callable(ns.get('sum_even')) and ns['sum_even']([1, 2, 3, 4, 6]) == 12",
        actualExpr: "repr(ns['sum_even']([1, 2, 3, 4, 6])) if callable(ns.get('sum_even')) else 'missing function'",
        expectedDisplay: '12',
      },
      {
        id: 't2',
        description: 'sum_even([1, 3, 5]) -> 0',
        checkExpr: "callable(ns.get('sum_even')) and ns['sum_even']([1, 3, 5]) == 0",
        actualExpr: "repr(ns['sum_even']([1, 3, 5])) if callable(ns.get('sum_even')) else 'missing function'",
        expectedDisplay: '0',
      },
      {
        id: 't3',
        description: 'sum_even([]) -> 0',
        checkExpr: "callable(ns.get('sum_even')) and ns['sum_even']([]) == 0",
        actualExpr: "repr(ns['sum_even']([])) if callable(ns.get('sum_even')) else 'missing function'",
        expectedDisplay: '0',
      },
    ],
  },
  8: {
    levelNumber: 8,
    title: 'While Loops & Break',
    lessonGoal:
      'Write a function count_until_negative(numbers) that uses a loop to count how many non-negative numbers appear before the first negative number.',
    starterCode: 'def count_until_negative(numbers):\n    count = 0\n    # stop when a negative number is reached\n    return count\n',
    hintsSummary: 'Use break as soon as an element is < 0.',
    testCases: [
      {
        id: 't1',
        description: 'count_until_negative([4, 0, 7, -2, 5]) -> 3',
        checkExpr: "callable(ns.get('count_until_negative')) and ns['count_until_negative']([4, 0, 7, -2, 5]) == 3",
        actualExpr: "repr(ns['count_until_negative']([4, 0, 7, -2, 5])) if callable(ns.get('count_until_negative')) else 'missing function'",
        expectedDisplay: '3',
      },
      {
        id: 't2',
        description: 'count_until_negative([-1, 2, 3]) -> 0',
        checkExpr: "callable(ns.get('count_until_negative')) and ns['count_until_negative']([-1, 2, 3]) == 0",
        actualExpr: "repr(ns['count_until_negative']([-1, 2, 3])) if callable(ns.get('count_until_negative')) else 'missing function'",
        expectedDisplay: '0',
      },
      {
        id: 't3',
        description: 'count_until_negative([1, 2, 3]) -> 3',
        checkExpr: "callable(ns.get('count_until_negative')) and ns['count_until_negative']([1, 2, 3]) == 3",
        actualExpr: "repr(ns['count_until_negative']([1, 2, 3])) if callable(ns.get('count_until_negative')) else 'missing function'",
        expectedDisplay: '3',
      },
    ],
  },
  9: {
    levelNumber: 9,
    title: 'Range & Step Patterns',
    lessonGoal:
      'Write a function multiples_of_three(limit) that returns a list of multiples of 3 from 3 up to and including limit.',
    starterCode: 'def multiples_of_three(limit):\n    return []\n',
    hintsSummary: 'Use range(3, limit + 1, 3) and convert or append into a list.',
    testCases: [
      {
        id: 't1',
        description: 'multiples_of_three(10) -> [3, 6, 9]',
        checkExpr: "callable(ns.get('multiples_of_three')) and ns['multiples_of_three'](10) == [3, 6, 9]",
        actualExpr: "repr(ns['multiples_of_three'](10)) if callable(ns.get('multiples_of_three')) else 'missing function'",
        expectedDisplay: '[3, 6, 9]',
      },
      {
        id: 't2',
        description: 'multiples_of_three(9) -> [3, 6, 9]',
        checkExpr: "callable(ns.get('multiples_of_three')) and ns['multiples_of_three'](9) == [3, 6, 9]",
        actualExpr: "repr(ns['multiples_of_three'](9)) if callable(ns.get('multiples_of_three')) else 'missing function'",
        expectedDisplay: '[3, 6, 9]',
      },
      {
        id: 't3',
        description: 'multiples_of_three(2) -> []',
        checkExpr: "callable(ns.get('multiples_of_three')) and ns['multiples_of_three'](2) == []",
        actualExpr: "repr(ns['multiples_of_three'](2)) if callable(ns.get('multiples_of_three')) else 'missing function'",
        expectedDisplay: '[]',
      },
    ],
  },
  10: {
    levelNumber: 10,
    title: 'Unit 1 Milestone Challenge',
    lessonGoal:
      'Write a function fizzbuzz_list(n) that returns a list from 1 to n where multiples of 3 become "Fizz", multiples of 5 become "Buzz", multiples of both become "FizzBuzz", and other numbers stay integers.',
    starterCode: 'def fizzbuzz_list(n):\n    result = []\n    return result\n',
    hintsSummary: 'Check divisibility by 15 (both 3 and 5) before checking 3 or 5 separately.',
    testCases: [
      {
        id: 't1',
        description: 'fizzbuzz_list(5) -> [1, 2, "Fizz", 4, "Buzz"]',
        checkExpr: "callable(ns.get('fizzbuzz_list')) and ns['fizzbuzz_list'](5) == [1, 2, 'Fizz', 4, 'Buzz']",
        actualExpr: "repr(ns['fizzbuzz_list'](5)) if callable(ns.get('fizzbuzz_list')) else 'missing function'",
        expectedDisplay: "[1, 2, 'Fizz', 4, 'Buzz']",
      },
      {
        id: 't2',
        description: '15th element of fizzbuzz_list(15) is "FizzBuzz"',
        checkExpr: "callable(ns.get('fizzbuzz_list')) and len(ns['fizzbuzz_list'](15)) == 15 and ns['fizzbuzz_list'](15)[-1] == 'FizzBuzz'",
        actualExpr: "repr(ns['fizzbuzz_list'](15)[-1]) if callable(ns.get('fizzbuzz_list')) and ns['fizzbuzz_list'](15) else 'missing'",
        expectedDisplay: "'FizzBuzz'",
      },
    ],
  },
  16: {
    levelNumber: 16,
    title: 'List Indexing & Slicing',
    lessonGoal:
      'Write a function middle_items(items) that returns a new list without the first and last element (or [] if len < 3).',
    starterCode: 'def middle_items(items):\n    return []\n',
    hintsSummary: 'Slice items[1:-1] when there are at least 3 elements.',
    testCases: [
      {
        id: 't1',
        description: 'middle_items([10, 20, 30, 40]) -> [20, 30]',
        checkExpr: "callable(ns.get('middle_items')) and ns['middle_items']([10, 20, 30, 40]) == [20, 30]",
        actualExpr: "repr(ns['middle_items']([10, 20, 30, 40])) if callable(ns.get('middle_items')) else 'missing function'",
        expectedDisplay: '[20, 30]',
      },
      {
        id: 't2',
        description: 'middle_items([1, 2]) -> []',
        checkExpr: "callable(ns.get('middle_items')) and ns['middle_items']([1, 2]) == []",
        actualExpr: "repr(ns['middle_items']([1, 2])) if callable(ns.get('middle_items')) else 'missing function'",
        expectedDisplay: '[]',
      },
    ],
  },
  18: {
    levelNumber: 18,
    title: 'List Comprehensions',
    lessonGoal:
      'Write a function square_positives(nums) that returns a list of x * x for each x > 0 in nums.',
    starterCode: 'def square_positives(nums):\n    return []\n',
    hintsSummary: 'Try [x * x for x in nums if x > 0].',
    testCases: [
      {
        id: 't1',
        description: 'square_positives([-2, 0, 3, 5]) -> [9, 25]',
        checkExpr: "callable(ns.get('square_positives')) and ns['square_positives']([-2, 0, 3, 5]) == [9, 25]",
        actualExpr: "repr(ns['square_positives']([-2, 0, 3, 5])) if callable(ns.get('square_positives')) else 'missing function'",
        expectedDisplay: '[9, 25]',
      },
      {
        id: 't2',
        description: 'square_positives([-1, -4]) -> []',
        checkExpr: "callable(ns.get('square_positives')) and ns['square_positives']([-1, -4]) == []",
        actualExpr: "repr(ns['square_positives']([-1, -4])) if callable(ns.get('square_positives')) else 'missing function'",
        expectedDisplay: '[]',
      },
    ],
  },
  21: {
    levelNumber: 21,
    title: 'Defining Functions',
    lessonGoal:
      'Write a function greet(name, excited=False) that returns "Hello, <name>!" when excited is True or "Hello, <name>." when False.',
    starterCode: 'def greet(name, excited=False):\n    return ""\n',
    hintsSummary: 'Use a default parameter excited=False and pick punctuation based on excited.',
    testCases: [
      {
        id: 't1',
        description: 'greet("Luka") -> "Hello, Luka."',
        checkExpr: "callable(ns.get('greet')) and ns['greet']('Luka') == 'Hello, Luka.'",
        actualExpr: "repr(ns['greet']('Luka')) if callable(ns.get('greet')) else 'missing function'",
        expectedDisplay: "'Hello, Luka.'",
      },
      {
        id: 't2',
        description: 'greet("Nino", True) -> "Hello, Nino!"',
        checkExpr: "callable(ns.get('greet')) and ns['greet']('Nino', True) == 'Hello, Nino!'",
        actualExpr: "repr(ns['greet']('Nino', True)) if callable(ns.get('greet')) else 'missing function'",
        expectedDisplay: "'Hello, Nino!'",
      },
    ],
  },
  31: {
    levelNumber: 31,
    title: 'Dictionaries & Lookup',
    lessonGoal:
      'Write a function word_counts(words) that returns a dictionary mapping each word in the list to how many times it appears.',
    starterCode: 'def word_counts(words):\n    counts = {}\n    return counts\n',
    hintsSummary: 'Use counts[w] = counts.get(w, 0) + 1 inside a loop.',
    testCases: [
      {
        id: 't1',
        description: 'word_counts(["py", "go", "py"]) -> {"py": 2, "go": 1}',
        checkExpr: "callable(ns.get('word_counts')) and ns['word_counts'](['py', 'go', 'py']) == {'py': 2, 'go': 1}",
        actualExpr: "repr(ns['word_counts'](['py', 'go', 'py'])) if callable(ns.get('word_counts')) else 'missing function'",
        expectedDisplay: "{'py': 2, 'go': 1}",
      },
      {
        id: 't2',
        description: 'word_counts([]) -> {}',
        checkExpr: "callable(ns.get('word_counts')) and ns['word_counts']([]) == {}",
        actualExpr: "repr(ns['word_counts']([])) if callable(ns.get('word_counts')) else 'missing function'",
        expectedDisplay: '{}',
      },
    ],
  },
  41: {
    levelNumber: 41,
    title: 'Classes & __init__',
    lessonGoal:
      'Define a Counter class initialized with start=0 that stores self.value and provides .increment(step=1) returning the new value.',
    starterCode: 'class Counter:\n    def __init__(self, start=0):\n        pass\n\n    def increment(self, step=1):\n        pass\n',
    hintsSummary: 'Store self.value = start in __init__, then add step to self.value and return it in increment.',
    testCases: [
      {
        id: 't1',
        description: 'Counter().value starts at 0',
        checkExpr: "isinstance(ns.get('Counter'), type) and ns['Counter']().value == 0",
        actualExpr: "repr(ns['Counter']().value) if isinstance(ns.get('Counter'), type) else 'missing class'",
        expectedDisplay: '0',
      },
      {
        id: 't2',
        description: 'Counter(10).increment(5) returns 15 and updates .value',
        setupCode: '',
        checkExpr: "isinstance(ns.get('Counter'), type) and (lambda c: c.increment(5) == 15 and c.value == 15)(ns['Counter'](10))",
        actualExpr: "repr(ns['Counter'](10).increment(5)) if isinstance(ns.get('Counter'), type) else 'missing class'",
        expectedDisplay: '15',
      },
    ],
  },
};

function buildUnitFallbackChallenge(levelNumber: number, levelTitle: string): PythonCodingChallenge {
  const unit = Math.ceil(levelNumber / 10);
  if (unit === 1) {
    return {
      levelNumber,
      title: levelTitle,
      lessonGoal: `Practice ${levelTitle}: write a function check_range(n, low, high) that returns True if low <= n <= high, otherwise False.`,
      starterCode: 'def check_range(n, low, high):\n    return False\n',
      hintsSummary: 'Use chained comparisons like low <= n <= high.',
      testCases: [
        {
          id: 't1',
          description: 'check_range(5, 1, 10) -> True',
          checkExpr: "callable(ns.get('check_range')) and ns['check_range'](5, 1, 10) is True",
          actualExpr: "repr(ns['check_range'](5, 1, 10)) if callable(ns.get('check_range')) else 'missing function'",
          expectedDisplay: 'True',
        },
        {
          id: 't2',
          description: 'check_range(1, 1, 10) -> True',
          checkExpr: "callable(ns.get('check_range')) and ns['check_range'](1, 1, 10) is True",
          actualExpr: "repr(ns['check_range'](1, 1, 10)) if callable(ns.get('check_range')) else 'missing function'",
          expectedDisplay: 'True',
        },
        {
          id: 't3',
          description: 'check_range(12, 1, 10) -> False',
          checkExpr: "callable(ns.get('check_range')) and ns['check_range'](12, 1, 10) is False",
          actualExpr: "repr(ns['check_range'](12, 1, 10)) if callable(ns.get('check_range')) else 'missing function'",
          expectedDisplay: 'False',
        },
      ],
    };
  }
  if (unit === 2) {
    return {
      levelNumber,
      title: levelTitle,
      lessonGoal: `Practice ${levelTitle}: write a function unique_ordered(items) that returns a list with duplicates removed while preserving first-seen order.`,
      starterCode: 'def unique_ordered(items):\n    seen = []\n    return seen\n',
      hintsSummary: 'Iterate through items and append each element only if it is not already in seen.',
      testCases: [
        {
          id: 't1',
          description: 'unique_ordered([3, 1, 3, 2, 1]) -> [3, 1, 2]',
          checkExpr: "callable(ns.get('unique_ordered')) and ns['unique_ordered']([3, 1, 3, 2, 1]) == [3, 1, 2]",
          actualExpr: "repr(ns['unique_ordered']([3, 1, 3, 2, 1])) if callable(ns.get('unique_ordered')) else 'missing function'",
          expectedDisplay: '[3, 1, 2]',
        },
        {
          id: 't2',
          description: 'unique_ordered([]) -> []',
          checkExpr: "callable(ns.get('unique_ordered')) and ns['unique_ordered']([]) == []",
          actualExpr: "repr(ns['unique_ordered']([])) if callable(ns.get('unique_ordered')) else 'missing function'",
          expectedDisplay: '[]',
        },
      ],
    };
  }
  if (unit === 3) {
    return {
      levelNumber,
      title: levelTitle,
      lessonGoal: `Practice ${levelTitle}: write a function apply_twice(fn, value) that calls fn on value, then calls fn again on that result and returns it.`,
      starterCode: 'def apply_twice(fn, value):\n    return value\n',
      hintsSummary: 'Pass the return value of fn(value) back into fn(...).',
      testCases: [
        {
          id: 't1',
          description: 'apply_twice(lambda x: x + 3, 4) -> 10',
          checkExpr: "callable(ns.get('apply_twice')) and ns['apply_twice'](lambda x: x + 3, 4) == 10",
          actualExpr: "repr(ns['apply_twice'](lambda x: x + 3, 4)) if callable(ns.get('apply_twice')) else 'missing function'",
          expectedDisplay: '10',
        },
        {
          id: 't2',
          description: 'apply_twice(lambda s: s + "!", "go") -> "go!!"',
          checkExpr: "callable(ns.get('apply_twice')) and ns['apply_twice'](lambda s: s + '!', 'go') == 'go!!'",
          actualExpr: "repr(ns['apply_twice'](lambda s: s + '!', 'go')) if callable(ns.get('apply_twice')) else 'missing function'",
          expectedDisplay: "'go!!'",
        },
      ],
    };
  }
  if (unit === 4) {
    return {
      levelNumber,
      title: levelTitle,
      lessonGoal: `Practice ${levelTitle}: write a function invert_dict(mapping) that returns a new dict swapping keys and values.`,
      starterCode: 'def invert_dict(mapping):\n    return {}\n',
      hintsSummary: 'Loop over mapping.items() and build a dict with {value: key}.',
      testCases: [
        {
          id: 't1',
          description: 'invert_dict({"a": 1, "b": 2}) -> {1: "a", 2: "b"}',
          checkExpr: "callable(ns.get('invert_dict')) and ns['invert_dict']({'a': 1, 'b': 2}) == {1: 'a', 2: 'b'}",
          actualExpr: "repr(ns['invert_dict']({'a': 1, 'b': 2})) if callable(ns.get('invert_dict')) else 'missing function'",
          expectedDisplay: "{1: 'a', 2: 'b'}",
        },
        {
          id: 't2',
          description: 'invert_dict({}) -> {}',
          checkExpr: "callable(ns.get('invert_dict')) and ns['invert_dict']({}) == {}",
          actualExpr: "repr(ns['invert_dict']({})) if callable(ns.get('invert_dict')) else 'missing function'",
          expectedDisplay: '{}',
        },
      ],
    };
  }
  return {
    levelNumber,
    title: levelTitle,
    lessonGoal: `Practice ${levelTitle}: write a function safe_divide(a, b) that returns a / b, or None if b == 0 (handle ZeroDivisionError).`,
    starterCode: 'def safe_divide(a, b):\n    return None\n',
    hintsSummary: 'Use try / except ZeroDivisionError or check b == 0 before dividing.',
    testCases: [
      {
        id: 't1',
        description: 'safe_divide(10, 2) -> 5.0',
        checkExpr: "callable(ns.get('safe_divide')) and ns['safe_divide'](10, 2) == 5.0",
        actualExpr: "repr(ns['safe_divide'](10, 2)) if callable(ns.get('safe_divide')) else 'missing function'",
        expectedDisplay: '5.0',
      },
      {
        id: 't2',
        description: 'safe_divide(10, 0) -> None',
        checkExpr: "callable(ns.get('safe_divide')) and ns['safe_divide'](10, 0) is None",
        actualExpr: "repr(ns['safe_divide'](10, 0)) if callable(ns.get('safe_divide')) else 'missing function'",
        expectedDisplay: 'None',
      },
    ],
  };
}

export function getPythonCodingChallenge(
  levelNumber: number,
  levelTitle?: string,
): PythonCodingChallenge {
  const exact = EXACT_CHALLENGES[levelNumber];
  if (exact) {
    return exact;
  }
  return buildUnitFallbackChallenge(
    levelNumber,
    levelTitle ?? `Python Lesson ${levelNumber}`,
  );
}
