import os
from token.tokenizer import Tokenizer

def main():
    filepath = 'data/input/userdata.txt'
    try:
        getdata = read_file(filepath)
        if not getdata:
            print("No data found in file.")
            return

        token = Tokenizer()
        token.train(getdata)
        token.save()

        #load
        token1 = Tokenizer()
        token1.load()
        encode = token1.encode("hi hello")
        decode = token1.decode(encode)
        
        print("Encoded:", encode)
        print("Decoded:", decode)


        # if token.vocab:
        #     print("Last 10 tokens:", list(token.vocab)[-10:])
        # else:
        #     print("No tokens found.")
    except Exception as e:
        print(f"Error: {e}")

def read_file(filepath):
    """Read file content"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        print(f"File {filepath} not found.")
        return ""
    except Exception as e:
        print(f"Error reading file: {e}")
        return ""

if __name__ == "__main__":
    main()
