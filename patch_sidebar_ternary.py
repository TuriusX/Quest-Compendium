import re
with open('src/components/GamesSidebar.tsx', 'r') as f:
    code = f.read()

# I want to remove from `              {isEditing ? (` to `              ) : (`
pattern = re.compile(r'              \{isEditing \? \((.*?)\) : \(\s+<>', re.DOTALL)
match = pattern.search(code)
if match:
    # also remove the closing `</>\n              )}` that corresponds to the ternary
    # Wait, it's `</>` then `)}`. Let's just find the `</>` and replace it
    code = code.replace(match.group(0), '              <>')
    
    # We need to find the `</>` and the `)}` that matches it.
    code = code.replace("""                  )}
                </>
              )}
            </div>
          );
        })}""", """                  )}
                </>
            </div>
          );
        })}""")
    
    with open('src/components/GamesSidebar.tsx', 'w') as f:
        f.write(code)
    print("Patched ternary")
else:
    print("Could not find ternary")
