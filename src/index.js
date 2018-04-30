// 比较函数，采用全等的比较方式
function defaultEqualityCheck(a, b) {
  return a === b
}

/**
 * 比较前后的参数是否相等，采用浅比较的方式，就只比较一层
 * 
 * @param {any} equalityCheck 比较函数，默认采用上面说到的全等比较函数
 * @param {any} prev 上一份参数
 * @param {any} next 当前份参数
 * @returns 比较的结果，布尔值
 */
function areArgumentsShallowlyEqual(equalityCheck, prev, next) {
  // 先简单比较下是否为null和参数个数是不是一致
  if (prev === null || next === null || prev.length !== next.length) {
    return false
  }

  // 这里就用比较函数做一层比较，👇的那个源码注释，说用for循环，而不用forEach这些，因为forEach, return后还是会继续循环, 而for会终止。当数据量大的时候，性能提升明显
  // Do this in a for loop (and not a `forEach` or an `every`) so we can determine equality as fast as possible.
  const length = prev.length
  for (let i = 0; i < length; i++) {
    // 不相等就return false
    // 这里提一下，官方Readme里的一些F&Q中
    // (1) 有问到和redux配合使用，为什么state发生变化了，缺不更新数据。那是因为用户
    // 的reducer没有返回一个新的state。这里浅比较就会得出先后数据是一致的，所以就不会更新。
    // 比如往todolist里插入一个todo，如果只是 state.todos.push(todo)的话，那prev.todos和
    // state.todos还是指向同一个引用，所以===比较是true, 故不会更新
    // (2) 也有问到为什么state没有变化，但老是重新计算一次。那是因为state中某个属性经过filter或者别的操作后
    // 与原来的属性还是一样，但由于是不同的引用了，所以===比较还是会返回false，就会导致重新计算。
    // 所以源头都是默认的比较函数，如果大家需要根据业务需求自定义自己的比较函数的话，也是可以的。下面会继续说
    if (!equalityCheck(prev[i], next[i])) {
      return false
    }
  }

  return true
}

/**
 * 默认的记忆函数
 * 
 * @export
 * @param {any} func 根据依赖的值，计算出新的值的函数
 * @param {any} [equalityCheck=defaultEqualityCheck] 比较函数，这里可以自定义
 * @returns function
 */
export function defaultMemoize(func, equalityCheck = defaultEqualityCheck) {
  // 存储上一次计算得到的结果和依赖的参数
  let lastArgs = null
  let lastResult = null
  // we reference arguments instead of spreading them for performance reasons
  // 返回一个函数
  return function () {
    // 该函数执行的时候，会先对上一份参数和当前的参数做个比较，比较方式由equalityCheck决定，如果用户不自定义的话，默认采用全等比较
    if (!areArgumentsShallowlyEqual(equalityCheck, lastArgs, arguments)) {
      // apply arguments instead of spreading for performance.
      // 如果是发生了改变，重新计算值，并存到lastResult中，下次如果没变的话可以直接返回
      lastResult = func.apply(null, arguments)
    }

    // 将当前的参数存储到lastArgs中，下次使用
    lastArgs = arguments

    // 返回结果
    return lastResult
  }
}

/**
 * 这个感觉就是拿来判断传入的inputSelector（reselect如是说，个人感觉就是获取依赖的函数）
 * 的类型是不是函数，如果有误就抛错误。反之就，直接返回func
 * 
 * @param {any} funcs 
 * @returns 
 */
function getDependencies(funcs) {
  const dependencies = Array.isArray(funcs[0]) ? funcs[0] : funcs

  if (!dependencies.every(dep => typeof dep === 'function')) {
    // 报错的内容类似 function,string,function....
    const dependencyTypes = dependencies.map(
      dep => typeof dep
    ).join(', ')
    throw new Error(
      'Selector creators expect all input-selectors to be functions, ' +
      `instead received the following types: [${dependencyTypes}]`
    )
  }

  return dependencies
}


/**
 * createSelector的创建函数
 * 
 * @export
 * @param {any} memoize 记忆函数
 * @param {any} memoizeOptions 其余的一些option，比如比较函数
 * @returns function
 */
export function createSelectorCreator(memoize, ...memoizeOptions) {
  return (...funcs) => {
    // 重新计算的次数
    let recomputations = 0
    // 取出计算的函数
    const resultFunc = funcs.pop()
    // 将所有获取依赖的函数传入getDependencies，判断是不是都是函数
    const dependencies = getDependencies(funcs)

    // 这里调用了memoize，传入一个func和传入的option，所以这里是生成真正核心的计算代码
    // 而这个func就是我们自己定义的根据依赖，计算出数据的方法，也是我们createSelector时
    // 传入的最后一个参数，同时也传入memoizeOptions，一般是传入自定义的比较函数
    // 
    // 而这个memoize返回的函数，我称为真正的记忆函数，当被调用时，传入的是我们传入的inputSelector的返回值，
    // 而这个inputSelector一般是从store的state中取值，所以每次dispatch一个redux时
    // 会导致组件和store都会被connect一遍，而这个函数会被调用，比较上次的state和这次
    // 是不是一样，是一样就不计算了，返回原来的值，反之返回新计算的值。
    const memoizedResultFunc = memoize(
      function () {
        recomputations++
        // apply arguments instead of spreading for performance.
        return resultFunc.apply(null, arguments)
      },
      ...memoizeOptions
    )

    // 这里是默认使用defaultMemoize，额，这里传入arguments应该是state和props，算是又做了一层优化
    // 因为reducer是不一定会返回一个新的state，所以state没变的时候，真正的记忆函数就不用被调用。
    // If a selector is called with the exact same arguments we don't need to traverse our dependencies again.
    const selector = defaultMemoize(function () {
      const params = []
      const length = dependencies.length

      // 根据传入的inputSelector来从state中获取依赖值
      for (let i = 0; i < length; i++) {
        // apply arguments instead of spreading and mutate a local list of params for performance.
        params.push(dependencies[i].apply(null, arguments))
      }
      // 调用真正的记忆函数
      // apply arguments instead of spreading for performance.
      return memoizedResultFunc.apply(null, params)
    })

    // 最后返回
    selector.resultFunc = resultFunc
    selector.recomputations = () => recomputations
    selector.resetRecomputations = () => recomputations = 0
    return selector
  }
}

// createSelector就是传入默认的记忆函数，使用默认的比较函数创建的
export const createSelector = createSelectorCreator(defaultMemoize)

export function createStructuredSelector(selectors, selectorCreator = createSelector) {
  if (typeof selectors !== 'object') {
    throw new Error(
      'createStructuredSelector expects first argument to be an object ' +
      `where each property is a selector, instead received a ${typeof selectors}`
    )
  }
  const objectKeys = Object.keys(selectors)
  return selectorCreator(
    objectKeys.map(key => selectors[key]),
    (...values) => {
      return values.reduce((composition, value, index) => {
        composition[objectKeys[index]] = value
        return composition
      }, {})
    }
  )
}
