# Test file for grouped import questions
import os
import sys
import json

from pathlib import Path
from collections import defaultdict, OrderedDict
from typing import List, Dict, Optional, Union, Callable

import numpy as np
from pandas import DataFrame, Series, read_csv, read_json

# Non-import statement breaks the group
x = 1

import requests  # New group starts here
from urllib.parse import urljoin as join_url, urlparse

def main():
    # Nested imports inside function
    import threading
    from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor
    
    print("Hello")

class MyClass:
    def method(self):
        pass
