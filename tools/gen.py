#!/usr/bin/env python3
import re
import sys
import os
import datetime
import subprocess
from typing import List, Dict, Any, Tuple, Optional

class CommentParser:
    """A simple parser for C-style block comments that extracts annotations."""

    def __init__(self, comment_text):
        # Remove the opening and closing comment markers
        comment_text = comment_text.strip()
        if comment_text.startswith('/*'):
            comment_text = comment_text[2:]
        if comment_text.endswith('*/'):
            comment_text = comment_text[:-2]

        # Split into lines and clean each line
        self.lines = []
        for line in comment_text.splitlines():
            line = line.strip()
            # Remove leading asterisks and spaces
            if line.startswith('*'):
                line = line[1:]
            line = line.strip()
            if line:  # Only add non-empty lines
                self.lines.append(line)

    def get_brief(self):
        """Extract @brief annotation."""
        for line in self.lines:
            if line.startswith("@brief "):
                return line[len("@brief "):].strip()
        return None

    def get_category(self):
        """Extract @category annotation."""
        for line in self.lines:
            if line.startswith("@category "):
                return line[len("@category "):].strip()
        return "Other"

    def get_ts_params(self):
        """Extract all @tsparam annotations."""
        params = []
        for line in self.lines:
            if line.startswith("@tsparam "):
                param_text = line[len("@tsparam "):].strip()
                parts = param_text.split(maxsplit=1)
                if len(parts) == 2:
                    name, type_str = parts
                    params.append({"name": name, "type": type_str})
        return params

    def get_ts_return(self):
        """Extract @tsreturn annotation."""
        for line in self.lines:
            if line.startswith("@tsreturn "):
                return line[len("@tsreturn "):].strip()
        return "void"

    def get_param_descriptions(self):
        """Extract @param annotations with descriptions."""
        param_descs = {}
        for line in self.lines:
            if line.startswith("@param "):
                param_text = line[len("@param "):].strip()
                parts = param_text.split(maxsplit=1)
                if len(parts) == 2:
                    param_name, description = parts
                    param_descs[param_name] = description
        return param_descs

    def get_return_description(self):
        """Extract @return annotation with description."""
        for line in self.lines:
            if line.startswith("@return "):
                return line[len("@return "):].strip()
        return None


class TypeScriptInterfaceGenerator:
    def __init__(self):
        # Pattern to match block comments followed by HAKO_ functions
        self.function_pattern = r"(?P<comment>/\*(?:\*(?!/)|[^*])*\*/)\s*\r?\n\s*.*?\b(?P<func>HAKO_[A-Za-z0-9_]+)\b\s*\((?P<params>[^)]*)\)"

    def extract_function_info(self, c_header: str) -> List[Dict[str, Any]]:
        """Extract functions from C header file"""
        functions = []

        for match in re.finditer(self.function_pattern, c_header, re.DOTALL):
            comment_text = match.group("comment")
            function_name = match.group("func")

            parser = CommentParser(comment_text)

            # Get function data from comment
            brief = parser.get_brief()
            category = parser.get_category()
            params = parser.get_ts_params()
            param_descriptions = parser.get_param_descriptions()
            return_type = parser.get_ts_return()
            return_description = parser.get_return_description()

            # Attach descriptions to params
            for param in params:
                name = param["name"]
                if name in param_descriptions:
                    param["description"] = param_descriptions[name]

            # Initialize function data
            function_data = {
                "name": function_name,
                "brief": brief,
                "category": category,
                "params": params,
                "return_type": return_type,
                "return_description": return_description
            }

            functions.append(function_data)

        return functions

    def get_git_info(self) -> Dict[str, str]:
        """Gather git information about the current repository"""
        git_info = {
            "commit": "",
            "branch": "",
            "author": "",
            "remote": ""
        }

        try:
            # Get the current commit hash
            git_info["commit"] = subprocess.check_output(
                ["git", "rev-parse", "HEAD"],
                stderr=subprocess.DEVNULL
            ).decode('utf-8').strip()

            # Get the current branch name
            git_info["branch"] = subprocess.check_output(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                stderr=subprocess.DEVNULL
            ).decode('utf-8').strip()

            # Get the last commit author
            git_info["author"] = subprocess.check_output(
                ["git", "log", "-1", "--pretty=format:%an <%ae>"],
                stderr=subprocess.DEVNULL
            ).decode('utf-8').strip()

            # Get the remote URL
            try:
                git_info["remote"] = subprocess.check_output(
                    ["git", "remote", "get-url", "origin"],
                    stderr=subprocess.DEVNULL
                ).decode('utf-8').strip()
            except subprocess.CalledProcessError:
                # No remote or not named "origin"
                git_info["remote"] = "No remote found"

        except (subprocess.CalledProcessError, FileNotFoundError):
            # Git command failed or git is not installed
            pass

        return git_info

    def generate_metadata_header(self, source_file: Optional[str] = None) -> List[str]:
        """Generate metadata header with date, time, and git info"""
        now = datetime.datetime.now()
        formatted_date = now.strftime("%Y-%m-%d %H:%M:%S")

        metadata = [
            "/**",
            f" * Generated on: {formatted_date}",
        ]

        if source_file and source_file != "-":
            metadata.append(f" * Source file: {os.path.basename(source_file)}")

        git_info = self.get_git_info()
        if git_info["commit"]:
            metadata.append(f" * Git commit: {git_info['commit']}")
            metadata.append(f" * Git branch: {git_info['branch']}")
            metadata.append(f" * Git author: {git_info['author']}")
            if git_info["remote"] != "No remote found":
                metadata.append(f" * Git remote: {git_info['remote']}")

        metadata.append(" */")
        metadata.append("")

        return metadata

    def generate_ts_interface(self, functions: List[Dict[str, Any]], interface_name: str = "HakoExports", source_file: Optional[str] = None) -> str:
        """Generate TypeScript interface from extracted functions with metadata"""
        # Start with metadata header
        lines = self.generate_metadata_header(source_file)

        # Add standard interface header
        lines.extend([
            "/**",
            " * Generated TypeScript interface for QuickJS exports",
            " */",
            "",
            "import type {",
            "    JSRuntimePointer,",
            "    JSContextPointer,",
            "    JSValuePointer,",
            "    JSValueConstPointer,",
            "    CString,",
            "    JSVoid,",
            "    OwnedHeapChar,",
            "    LEPUS_BOOL,",
            "    LEPUSModuleDef",
            "} from './types';",
            "",
            "/**",
            f" * Interface for the raw WASM exports from QuickJS",
            " */",
            f"export interface {interface_name} {{",
            "    // Memory",
            "    memory: WebAssembly.Memory;",
            ""
        ])

        # Group functions by category
        categories = {}
        for func in functions:
            category = func["category"]
            if category not in categories:
                categories[category] = []

            categories[category].append(func)

        # Sort categories (Memory first, then alphabetically)
        sorted_categories = sorted(categories.keys())
        if "Memory" in sorted_categories:
            sorted_categories.remove("Memory")
            sorted_categories = ["Memory"] + sorted_categories

        for category in sorted_categories:
            if category != "Memory":  # Already added "Memory" header
                lines.append(f"    // {category}")

            for func in sorted(categories[category], key=lambda x: x["name"]):
                # Generate TSDoc comment if brief is available
                if func["brief"]:
                    lines.append(f"    /**")
                    lines.append(f"     * {func['brief']}")

                    # Add parameter documentation
                    if func["params"]:
                        lines.append(f"     *")
                        for param in func["params"]:
                            desc = param.get("description", "")
                            lines.append(f"     * @param {param['name']} {desc}")

                    # Add return documentation if available
                    if func["return_type"] != "void" and func.get("return_description"):
                        if not func["params"]:  # Add spacer if no params were added
                            lines.append(f"     *")
                        lines.append(f"     * @returns {func['return_description']}")

                    lines.append(f"     */")

                param_list = []
                for param in func["params"]:
                    param_list.append(f"{param['name']}: {param['type']}")

                return_type = func["return_type"]
                lines.append(f"    {func['name']}({', '.join(param_list)}): {return_type};")

            lines.append("")

        lines.append("}")
        return "\n".join(lines)

def main():
    generator = TypeScriptInterfaceGenerator()

    input_file = "-"  # Default to stdin
    output_file = None

    if len(sys.argv) >= 2:
        input_file = sys.argv[1]

    if len(sys.argv) >= 3:
        output_file = sys.argv[2]

    # Read input
    if input_file == "-":
        c_header = sys.stdin.read()
    else:
        with open(input_file, 'r') as f:
            c_header = f.read()

    # Process
    functions = generator.extract_function_info(c_header)
    ts_interface = generator.generate_ts_interface(functions, source_file=input_file)

    # Output
    if output_file:
        with open(output_file, 'w') as f:
            f.write(ts_interface)
    else:
        print(ts_interface)

if __name__ == "__main__":
    main()
