ifeq ($(VERSION), "")
	@echo "Use gmake"
endif

# Globals
MAKE = make
TAR = tar
UNAME := $(shell uname)
ifeq ($(UNAME), SunOS)
	MAKE = gmake
	TAR = gtar
endif

NPM := npm_config_tar=$(TAR) npm

LINT = ./node_modules/.javascriptlint/build/install/jsl --conf ./.jsl.conf
RELEASE = python ./node_modules/.cutarelease/cutarelease.py -f package.json
STYLE = ./node_modules/.jsstyle/jsstyle

TAP = ./node_modules/.bin/tap

# Targets

.PHONY:  all clean install lint install test

all:: test

node_modules/.installed:
	$(NPM) install

	if [[ ! -d node_modules/.javascriptlint ]]; then \
		git clone https://github.com/davepacheco/javascriptlint node_modules/.javascriptlint; \
	fi

	if [[ ! -d node_modules/.jsstlye ]]; then \
		git clone https://github.com/mcavage/jsstyle node_modules/.jsstyle; \
	fi

	if [[ ! -d node_modules/.cutarelease ]]; then \
		git clone https://github.com/trentm/cutarelease node_modules/.cutarelease; \
	fi

	@(cd ./node_modules/.javascriptlint && $(MAKE) install)
	@touch ./node_modules/.installed

install:	./node_modules/.installed

lint:	install
	@echo "\n\n---- Running Linter...\n"
	${LINT} lib/*.js test/*.js

	@echo "\n\n---- Running Style Check...\n"
	@find lib -name *.js | xargs ${STYLE}
	@find test -name *.js | xargs ${STYLE}
	@echo "Style Ok."

_test:
	@echo "\n\n--- Running unit tests...\n"
	$(NPM) test

test: install _test lint

release: test
	$(RELEASE)

clean:
	@rm -fr node_modules *.log
